"""
Synchronize snapshot.xml metadata into Supabase via the official Python client.

Loads yacht identity from JSON config (never from XML).
Upserts: yachts, devices, variable_definitions.

Does NOT ingest telemetry history or device_current_values — those are fed by
datalogger/realtime pipelines later.

Usage:
  pip install -r requirements-snapshot-ingest.txt
  copy .env.example to .env and set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  python snapshot_ingest.py --config config/yacht_config.example.json --xml snapshot.xml

Optional:
  python snapshot_ingest.py ... --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Iterator, List, Tuple
from xml.etree import ElementTree as ET

import parse_snapshot as ps
from supabase import Client, create_client

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def load_yacht_config(path: Path) -> Dict[str, str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    slug = str(data.get("slug", "")).strip().lower()
    name = str(data.get("name", "")).strip()
    if not slug or not name:
        raise ValueError("yacht config must include non-empty 'slug' and 'name'")
    return {"slug": slug, "name": name}


def normalize_product_id(raw: str | None) -> str:
    text = (raw or "").strip()
    return text if text else "__unknown__"


def device_product_id(device: Any) -> str:
    boot = device.find("BootLoaderGeneral")
    if boot is None:
        return "__unknown__"
    return normalize_product_id(ps.get_child_text(boot, "ProductID", ""))


def iter_variable_definitions_for_device(device: Any, product_id: str) -> Iterator[Dict[str, Any]]:
    strings_map = ps.load_strings_map(device)

    for section_name in ("monitoring", "alarm", "history"):
        section = device.find(section_name)
        if section is None:
            continue

        group_map = ps.build_group_map_for_section(section, strings_map)
        variables_parent = section.find("variables")
        variable_nodes = variables_parent.findall("variable") if variables_parent is not None else section.findall("variable")

        for variable in variable_nodes:
            if ps.to_int(ps.get_child_text(variable, "eventable", "0"), 0) == 1:
                continue

            index = ps.to_int(variable.get("index"))
            visualization_type = ps.to_int(ps.get_child_text(variable, "VisualizationType", ""))
            parsed_type = ps.resolve_type(visualization_type, section_name)
            if index is None or parsed_type is None:
                continue

            group_labels = group_map.get(index, [])
            group_label = ps.pick_best_group(group_labels)

            text_value_id = ps.to_int(ps.get_child_text(variable, "TextValueID", ""))
            unit_string_id = ps.to_int(ps.get_child_text(variable, "UnitStringID", "0"), 0)
            writeable = ps.get_child_text(variable, "writeable", "0") == "1"

            label = strings_map.get(text_value_id, "") if text_value_id is not None else ""
            if not str(label).strip():
                label = f"(index {index})"

            unit = strings_map.get(unit_string_id) if unit_string_id else None

            yield {
                "product_id": product_id,
                "variable_index": index,
                "section": section_name,
                "group_name": group_label,
                "label": str(label).strip(),
                "unit": unit,
                "data_type": parsed_type,
                "writeable": writeable,
            }


def upsert_yacht(client: Client, slug: str, name: str) -> str:
    client.table("yachts").upsert({"slug": slug, "name": name}, on_conflict="slug").execute()

    result = (
        client.table("yachts")
        .select("id")
        .eq("slug", slug)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        raise RuntimeError("yacht upsert/select returned no row")
    return str(rows[0]["id"])


def chunked(items: List[Dict[str, Any]], size: int) -> Iterator[List[Dict[str, Any]]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def build_supabase_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_role_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment")
    return create_client(url, service_role_key)


def device_metadata_from_snapshot(device: Any, bus_id: int, strings_map: Dict[int, str]) -> Dict[str, Any]:
    summary = ps.build_device_summary_record(device, bus_id, strings_map)
    boot = device.find("BootLoaderGeneral")
    raw_pid = ps.get_child_text(boot, "ProductID", "").strip() if boot is not None else ""

    return {
        "bus_id": bus_id,
        "product_id": raw_pid or None,
        "display_name": summary.get("device_name"),
        "product_name": summary.get("product_name"),
        "serial_number": summary.get("serial_number"),
        "firmware_version": summary.get("firmware_version"),
        "software_version": summary.get("software_version"),
    }


def ingest_snapshot(xml_path: Path, yacht_slug: str, yacht_name: str, *, dry_run: bool) -> Tuple[int, int, int]:
    tree = ET.parse(xml_path)
    root = tree.getroot()
    ps.strip_namespace(root)

    devices_processed = 0
    definitions_upserted = 0

    definitions_seen: set[Tuple[str, int]] = set()

    devices_rows: List[Dict[str, Any]] = []
    definition_rows: List[Dict[str, Any]] = []

    for device in root.iter("device"):
        bus_id = ps.to_int(device.get("BusID"))
        if bus_id is None:
            continue
        strings_map = ps.load_strings_map(device)
        product_id = device_product_id(device)
        meta = device_metadata_from_snapshot(device, bus_id, strings_map)
        devices_processed += 1

        devices_rows.append(
            {
                "bus_id": meta["bus_id"],
                "product_id": meta.get("product_id"),
                "display_name": meta.get("display_name"),
                "product_name": meta.get("product_name"),
                "serial_number": meta.get("serial_number"),
                "firmware_version": meta.get("firmware_version"),
                "software_version": meta.get("software_version"),
            }
        )

        for vrow in iter_variable_definitions_for_device(device, product_id):
            key = (vrow["product_id"], vrow["variable_index"])
            if key in definitions_seen:
                continue
            definitions_seen.add(key)
            definition_rows.append(vrow)
            definitions_upserted += 1

    if dry_run:
        print("[dry-run] would upsert yacht:", yacht_slug, yacht_name)
        return devices_processed, definitions_upserted, len(definitions_seen)

    client = build_supabase_client()
    yacht_id = upsert_yacht(client, yacht_slug, yacht_name)

    devices_payload = [{**row, "yacht_id": yacht_id} for row in devices_rows]
    for batch in chunked(devices_payload, 500):
        client.table("devices").upsert(batch, on_conflict="yacht_id,bus_id").execute()

    for batch in chunked(definition_rows, 500):
        client.table("variable_definitions").upsert(batch, on_conflict="product_id,variable_index").execute()

    return devices_processed, definitions_upserted, len(definitions_seen)

def main(argv: List[str]) -> int:
    if load_dotenv:
        load_dotenv()

    parser = argparse.ArgumentParser(description="Ingest Mastervolt snapshot.xml metadata into Supabase.")
    parser.add_argument("--config", type=Path, default=Path("config/yacht_config.example.json"), help="Yacht JSON config path")
    parser.add_argument("--xml", type=Path, default=Path("snapshot.xml"), help="Path to snapshot.xml")
    parser.add_argument("--dry-run", action="store_true", help="Parse only; no database writes")
    args = parser.parse_args(argv)

    if not args.xml.is_file():
        print(f"XML not found: {args.xml}", file=sys.stderr)
        return 1
    if not args.config.is_file():
        print(f"Config not found: {args.config}", file=sys.stderr)
        return 1

    yacht = load_yacht_config(args.config)

    dev_count, def_count, uniq_defs = ingest_snapshot(args.xml, yacht["slug"], yacht["name"], dry_run=args.dry_run)

    print(
        json.dumps(
            {
                "yacht_slug": yacht["slug"],
                "yacht_name": yacht["name"],
                "devices_upserted": dev_count,
                "variable_definition_rows_written": def_count,
                "unique_definition_keys": uniq_defs,
                "dry_run": args.dry_run,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
