from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
from ingest.telemetry_pipeline import (
    TelemetryIngestor,
    build_column_mappings_for_catalog,
    build_dry_run_report,
    parse_snapshot_catalog,
    parse_typed_value,
)
from supabase import create_client

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def resolve_database_url(cli_value: str) -> str:
    if cli_value.strip():
        return cli_value.strip()
    for env_name in ("DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL"):
        value = os.environ.get(env_name, "").strip()
        if value:
            return value
    return ""


def validate_database_url(database_url: str) -> tuple[bool, str]:
    if not database_url:
        return False, "Missing database url. Use --database-url or set DATABASE_URL/SUPABASE_DB_URL/POSTGRES_URL."

    parsed = urlparse(database_url)
    scheme = (parsed.scheme or "").lower()
    if scheme in {"http", "https"}:
        return (
            False,
            "DATABASE_URL is an HTTP API URL. Use a PostgreSQL DSN like postgresql+psycopg://user:pass@host:5432/dbname.",
        )
    if not scheme.startswith("postgresql"):
        return (
            False,
            f"Unsupported DATABASE_URL scheme '{scheme}'. Use postgresql:// or postgresql+psycopg://.",
        )
    return True, ""


def chunked_rows(rows: list[dict], size: int = 500) -> list[list[dict]]:
    return [rows[i : i + size] for i in range(0, len(rows), size)]


def ingest_via_supabase_api(
    *,
    supabase_url: str,
    supabase_service_key: str,
    yacht_id: str,
    snapshot_path: Path,
    datalogger_path: Path,
    report_limit: int,
) -> dict:
    client = create_client(supabase_url, supabase_service_key)
    device_rows = (
        client.table("devices")
        .select("id,bus_id,yacht_id,display_name,product_name,serial_number")
        .eq("yacht_id", yacht_id)
        .execute()
        .data
        or []
    )
    db_devices = {int(row["bus_id"]): row for row in device_rows if row.get("bus_id") is not None}

    aliases_by_device_id: dict[str, list[str]] = {}
    try:
        alias_rows = (
            client.table("device_aliases")
            .select("device_id,alias")
            .in_("device_id", [str(row["id"]) for row in device_rows if row.get("id")])
            .execute()
            .data
            or []
        )
        for alias_row in alias_rows:
            device_id = str(alias_row.get("device_id") or "")
            alias = str(alias_row.get("alias") or "").strip()
            if not device_id or not alias:
                continue
            aliases_by_device_id.setdefault(device_id, []).append(alias)
    except Exception:
        aliases_by_device_id = {}

    for row in device_rows:
        bus_id = row.get("bus_id")
        device_id = str(row.get("id") or "")
        if bus_id is None:
            continue
        db_devices[int(bus_id)]["aliases"] = aliases_by_device_id.get(device_id, [])

    snapshot_devices, metrics_by_bus = parse_snapshot_catalog(snapshot_path)
    mappings, unmapped_columns, dataframe = build_column_mappings_for_catalog(
        datalogger_path=datalogger_path,
        metrics_by_bus=metrics_by_bus,
        snapshot_devices=snapshot_devices,
        db_devices=db_devices,
    )
    by_col = {m.column_index: m for m in mappings}

    current_rows: dict[tuple[str, str], dict] = {}
    timeseries_rows: list[dict] = []
    alarm_values: list[tuple[dict, datetime]] = []

    for _, row in dataframe.iterrows():
        ts_raw = str(row.iloc[0]).strip()
        timestamp = pd.to_datetime(ts_raw, errors="coerce", utc=True)
        if pd.isna(timestamp):
            continue
        ts = timestamp.to_pydatetime()
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        for col, mapping in by_col.items():
            raw_value = str(row.iloc[col]) if col < len(row) else ""
            typed = parse_typed_value(raw_value, mapping.definition.value_type)
            if typed.quality == "missing":
                continue

            current_payload = {
                "yacht_id": mapping.yacht_id,
                "device_id": mapping.device_id,
                "metric_key": mapping.definition.metric_key,
                "section": mapping.definition.section,
                "group_name": mapping.definition.group_name,
                "label": mapping.definition.label,
                "unit": mapping.definition.unit,
                "value_type": mapping.definition.value_type,
                "numeric_value": typed.numeric_value,
                "text_value": typed.text_value,
                "bool_value": typed.bool_value,
                "raw_value": typed.raw_value,
                "quality": typed.quality,
                "source_timestamp": ts.isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            current_rows[(mapping.device_id, mapping.definition.metric_key)] = current_payload

            if mapping.definition.section == "monitoring":
                timeseries_rows.append(
                    {
                        "yacht_id": mapping.yacht_id,
                        "device_id": mapping.device_id,
                        "metric_key": mapping.definition.metric_key,
                        "ts": ts.isoformat(),
                        "numeric_value": typed.numeric_value,
                        "text_value": typed.text_value,
                        "bool_value": typed.bool_value,
                        "raw_value": typed.raw_value,
                        "quality": typed.quality,
                    }
                )
            elif mapping.definition.section == "alarm" and typed.bool_value is not None:
                alarm_values.append(
                    (
                        {
                            "yacht_id": mapping.yacht_id,
                            "device_id": mapping.device_id,
                            "metric_key": mapping.definition.metric_key,
                            "label": mapping.definition.label,
                            "group_name": mapping.definition.group_name,
                            "new_state": bool(typed.bool_value),
                            "raw_value": typed.raw_value,
                        },
                        ts,
                    )
                )

    # write telemetry_current
    current_payload_rows = list(current_rows.values())
    for batch in chunked_rows(current_payload_rows):
        client.table("telemetry_current").upsert(batch, on_conflict="device_id,metric_key").execute()

    # write telemetry_timeseries append-only
    for batch in chunked_rows(timeseries_rows):
        client.table("telemetry_timeseries").insert(batch).execute()

    # alarm transition detection against current state
    existing_alarm_rows = (
        client.table("alarm_current")
        .select("device_id,metric_key,active,first_triggered_at,last_changed_at")
        .eq("yacht_id", yacht_id)
        .execute()
        .data
        or []
    )
    state_map = {(str(r["device_id"]), str(r["metric_key"])): r for r in existing_alarm_rows}
    alarm_current_upserts: dict[tuple[str, str], dict] = {}
    alarm_events: list[dict] = []

    for alarm_payload, ts in alarm_values:
        key = (alarm_payload["device_id"], alarm_payload["metric_key"])
        prev = state_map.get(key)
        prev_state = prev.get("active") if prev else None
        new_state = alarm_payload["new_state"]
        changed = prev is not None and prev_state != new_state
        first_triggered = prev.get("first_triggered_at") if prev else None
        if new_state and first_triggered is None:
            first_triggered = ts.isoformat()
        if changed and new_state:
            first_triggered = ts.isoformat()

        if changed:
            alarm_events.append(
                {
                    "yacht_id": alarm_payload["yacht_id"],
                    "device_id": alarm_payload["device_id"],
                    "metric_key": alarm_payload["metric_key"],
                    "event_type": "triggered" if new_state else "cleared",
                    "previous_state": prev_state,
                    "new_state": new_state,
                    "ts": ts.isoformat(),
                    "start_time": ts.isoformat(),
                    "end_time": ts.isoformat() if not new_state else None,
                    "metadata": {
                        "label": alarm_payload["label"],
                        "group_name": alarm_payload["group_name"],
                        "raw_value": alarm_payload["raw_value"],
                    },
                }
            )

        alarm_current_upserts[key] = {
            "yacht_id": alarm_payload["yacht_id"],
            "device_id": alarm_payload["device_id"],
            "metric_key": alarm_payload["metric_key"],
            "active": new_state,
            "severity": None,
            "message": alarm_payload["label"],
            "first_triggered_at": first_triggered,
            "last_changed_at": ts.isoformat() if changed or prev is None else prev.get("last_changed_at"),
            "last_seen_at": ts.isoformat(),
        }
        state_map[key] = {"active": new_state, "first_triggered_at": first_triggered, "last_changed_at": ts.isoformat()}

    for batch in chunked_rows(list(alarm_current_upserts.values())):
        client.table("alarm_current").upsert(batch, on_conflict="device_id,metric_key").execute()
    for batch in chunked_rows(alarm_events):
        client.table("alarm_events").insert(batch).execute()

    return {
        "columns_total": max(len(dataframe.columns) - 1, 0),
        "columns_mapped": len(mappings),
        "columns_unmapped": len(unmapped_columns),
        "telemetry_current_upserts": len(current_rows),
        "telemetry_timeseries_inserts": len(timeseries_rows),
        "alarm_points_seen": len(alarm_values),
        "alarm_event_inserts": len(alarm_events),
        "dry_run": False,
        "matched_by_counts": {
            key: sum(1 for m in mappings if m.matched_by == key) for key in sorted({m.matched_by for m in mappings})
        },
        "unmapped_columns": [entry.__dict__ for entry in unmapped_columns[: max(report_limit, 0)]],
    }


def main(argv: list[str]) -> int:
    if load_dotenv:
        # Load root and backend env files for local dev convenience.
        load_dotenv(dotenv_path=Path(".env"), override=False)
        load_dotenv(dotenv_path=Path("backend/.env"), override=False)

    parser = argparse.ArgumentParser(description="Ingest DataLogger telemetry using snapshot.xml metric definitions.")
    parser.add_argument("--snapshot", type=Path, default=Path("snapshot.xml"), help="Path to snapshot.xml")
    parser.add_argument("--datalogger", type=Path, default=Path("DataLogger.txt"), help="Path to DataLogger.txt")
    parser.add_argument("--yacht-id", type=str, default=os.environ.get("YACHT_ID", ""), help="Target yacht UUID")
    parser.add_argument("--database-url", type=str, default="", help="PostgreSQL connection URL")
    parser.add_argument("--dry-run", action="store_true", help="Parse and report only; do not write rows")
    parser.add_argument(
        "--report-limit",
        type=int,
        default=25,
        help="Max unmapped columns to include in report",
    )
    args = parser.parse_args(argv)

    if not args.snapshot.is_file():
        print(f"Snapshot XML not found: {args.snapshot}", file=sys.stderr)
        return 1
    if not args.datalogger.is_file():
        print(f"DataLogger file not found: {args.datalogger}", file=sys.stderr)
        return 1
    if not args.yacht_id.strip():
        print("Missing yacht id. Use --yacht-id or set YACHT_ID.", file=sys.stderr)
        return 1

    if args.dry_run:
        supabase_url = os.environ.get("SUPABASE_URL", "").strip()
        supabase_service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if supabase_url and supabase_service_key:
            client = create_client(supabase_url, supabase_service_key)
            rows = (
                client.table("devices")
                .select("id,bus_id,yacht_id,display_name,product_name,serial_number")
                .eq("yacht_id", args.yacht_id.strip())
                .execute()
                .data
                or []
            )
            db_devices = {int(row["bus_id"]): row for row in rows if row.get("bus_id") is not None}
            aliases_by_device_id: dict[str, list[str]] = {}
            try:
                alias_rows = (
                    client.table("device_aliases")
                    .select("device_id,alias")
                    .in_("device_id", [str(row["id"]) for row in rows if row.get("id")])
                    .execute()
                    .data
                    or []
                )
                for alias_row in alias_rows:
                    device_id = str(alias_row.get("device_id") or "")
                    alias = str(alias_row.get("alias") or "").strip()
                    if not device_id or not alias:
                        continue
                    aliases_by_device_id.setdefault(device_id, []).append(alias)
            except Exception:
                aliases_by_device_id = {}

            for row in rows:
                bus_id = row.get("bus_id")
                device_id = str(row.get("id") or "")
                if bus_id is None:
                    continue
                db_devices[int(bus_id)]["aliases"] = aliases_by_device_id.get(device_id, [])
            result = build_dry_run_report(
                snapshot_xml_path=args.snapshot,
                datalogger_path=args.datalogger,
                db_devices=db_devices,
                report_limit=args.report_limit,
            )
            print(json.dumps(result, indent=2))
            return 0

    database_url = resolve_database_url(args.database_url)
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    supabase_service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not database_url and supabase_url and supabase_service_key:
        result = ingest_via_supabase_api(
            supabase_url=supabase_url,
            supabase_service_key=supabase_service_key,
            yacht_id=args.yacht_id.strip(),
            snapshot_path=args.snapshot,
            datalogger_path=args.datalogger,
            report_limit=args.report_limit,
        )
        print(json.dumps(result, indent=2))
        return 0

    ok, error_message = validate_database_url(database_url)
    if not ok:
        print(error_message, file=sys.stderr)
        return 1

    ingestor = TelemetryIngestor(database_url=database_url, yacht_id=args.yacht_id.strip())
    result = ingestor.ingest(
        snapshot_xml_path=args.snapshot,
        datalogger_path=args.datalogger,
        dry_run=args.dry_run,
        report_limit=args.report_limit,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
