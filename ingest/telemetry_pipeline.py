from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from xml.etree import ElementTree as ET

import pandas as pd
from sqlalchemy import MetaData, Table, create_engine, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

import parse_snapshot as ps


@dataclass(frozen=True)
class SnapshotDevice:
    bus_id: int
    display_name: str
    product_name: Optional[str]
    serial_number: Optional[str]
    aliases: Tuple[str, ...]


@dataclass(frozen=True)
class MetricDefinition:
    bus_id: int
    section: str
    group_name: Optional[str]
    label: str
    unit: Optional[str]
    value_type: str
    metric_key: str


@dataclass(frozen=True)
class ColumnMapping:
    column_index: int
    device_id: str
    yacht_id: str
    definition: MetricDefinition
    matched_by: str = "unknown"
    confidence: float = 0.0


@dataclass(frozen=True)
class TypedValue:
    numeric_value: Optional[float]
    text_value: Optional[str]
    bool_value: Optional[bool]
    raw_value: str
    quality: str


@dataclass(frozen=True)
class UnmappedColumn:
    column_index: int
    device_name: str
    section: str
    group_name: str
    label: str
    reason: str
    normalized_device_name: str = ""
    closest_match: str = ""
    confidence: float = 0.0
    attempted_matches: Tuple[str, ...] = ()


@dataclass(frozen=True)
class MatchResult:
    matched_device_id: Optional[str]
    bus_id: Optional[int]
    matched_by: str
    confidence: float
    closest_match: str
    attempted_matches: Tuple[str, ...]
    reason: str


def resolve_device_identity(
    raw_device_name: str,
    *,
    db_devices: Dict[int, Dict[str, Any]],
    alias_owner: Dict[str, int],
    name_owner: Dict[str, int],
    serial_owner: Dict[str, int],
    fuzzy_threshold: float = 0.92,
) -> MatchResult:
    variants = identity_variants(raw_device_name)
    best_variant = variants[0] if variants else ""

    for candidate in variants:
        bus_id = alias_owner.get(candidate)
        if bus_id is not None and bus_id in db_devices:
            return MatchResult(str(db_devices[bus_id]["id"]), bus_id, "alias_exact", 1.0, candidate, (candidate,), "matched")

    for candidate in variants:
        bus_id = name_owner.get(candidate)
        if bus_id is not None and bus_id in db_devices:
            return MatchResult(str(db_devices[bus_id]["id"]), bus_id, "device_name_exact", 1.0, candidate, (candidate,), "matched")

    bus_candidate = _extract_bus_id_candidate(raw_device_name)
    if bus_candidate is not None and bus_candidate in db_devices:
        return MatchResult(str(db_devices[bus_candidate]["id"]), bus_candidate, "bus_id_exact", 1.0, str(bus_candidate), (str(bus_candidate),), "matched")

    serial_candidate = _extract_serial_candidate(raw_device_name)
    if serial_candidate and serial_candidate in serial_owner:
        bus_id = serial_owner[serial_candidate]
        if bus_id in db_devices:
            return MatchResult(str(db_devices[bus_id]["id"]), bus_id, "serial_exact", 1.0, serial_candidate, (serial_candidate,), "matched")

    pool = sorted(set(alias_owner.keys()) | set(name_owner.keys()))
    if best_variant and pool:
        scored = sorted(
            ((difflib.SequenceMatcher(None, best_variant, candidate).ratio(), candidate) for candidate in pool),
            reverse=True,
        )
        top = scored[:3]
        attempted = tuple(f"{candidate}:{score:.2f}" for score, candidate in top)
        top_score, top_name = top[0]
        second_score = top[1][0] if len(top) > 1 else 0.0
        owner = alias_owner.get(top_name) or name_owner.get(top_name)
        if owner is not None and owner in db_devices and top_score >= fuzzy_threshold and (top_score - second_score) >= 0.05:
            return MatchResult(
                str(db_devices[owner]["id"]),
                owner,
                "fuzzy_match",
                float(round(top_score, 4)),
                top_name,
                attempted,
                "matched",
            )
        return MatchResult(None, None, "none", float(round(top_score, 4)), top_name, attempted, "below_confidence_threshold")

    return MatchResult(None, None, "none", 0.0, "", tuple(), "no_candidates")


def build_column_mappings_for_catalog(
    datalogger_path: Path,
    metrics_by_bus: Dict[int, List[MetricDefinition]],
    snapshot_devices: Dict[int, SnapshotDevice],
    db_devices: Dict[int, Dict[str, Any]],
) -> Tuple[List[ColumnMapping], List[UnmappedColumn], pd.DataFrame]:
    header_lines = datalogger_path.read_text(encoding="utf-8").splitlines()[:5]
    if len(header_lines) < 5:
        raise ValueError("DataLogger header is incomplete")
    header_devices = header_lines[1].split("\t")
    header_sections = header_lines[2].split("\t")
    header_groups = header_lines[3].split("\t")
    header_labels = header_lines[4].split("\t")

    df = pd.read_csv(datalogger_path, sep="\t", skiprows=5, header=None, dtype=str, keep_default_na=False)
    df = df.fillna("")

    alias_owner: Dict[str, int] = {}
    name_owner: Dict[str, int] = {}
    serial_owner: Dict[str, int] = {}
    for bus_id, snapshot_device in snapshot_devices.items():
        candidates: set[str] = set()
        candidates.update(identity_variants(snapshot_device.display_name))
        candidates.update(identity_variants(snapshot_device.product_name))
        for alias in snapshot_device.aliases:
            candidates.update(identity_variants(alias))
        if snapshot_device.serial_number:
            serial_owner.setdefault(_extract_serial_candidate(snapshot_device.serial_number), bus_id)
        db_device = db_devices.get(bus_id)
        if db_device:
            candidates.update(identity_variants(db_device.get("display_name")))
            candidates.update(identity_variants(db_device.get("product_name")))
            for alias in db_device.get("aliases", []) or []:
                candidates.update(identity_variants(alias))
            if db_device.get("serial_number"):
                serial_owner.setdefault(_extract_serial_candidate(str(db_device.get("serial_number"))), bus_id)
        for candidate in candidates:
            if candidate:
                alias_owner.setdefault(candidate, bus_id)
                name_owner.setdefault(candidate, bus_id)
    column_mappings: List[ColumnMapping] = []
    unmapped_columns: List[UnmappedColumn] = []
    for col in range(1, len(df.columns)):
        if col >= len(header_devices):
            continue
        raw_device = header_devices[col] if col < len(header_devices) else ""
        raw_section = header_sections[col] if col < len(header_sections) else ""
        raw_group = header_groups[col] if col < len(header_groups) else ""
        raw_label = header_labels[col] if col < len(header_labels) else ""
        section = normalize_text(raw_section)
        if section not in {"monitoring", "alarm", "history"}:
            if section:
                unmapped_columns.append(
                    UnmappedColumn(
                        column_index=col,
                        device_name=str(raw_device),
                        section=str(raw_section),
                        group_name=str(raw_group),
                        label=str(raw_label),
                        reason="ignored_section",
                    )
                )
            continue

        match = resolve_device_identity(
            raw_device,
            db_devices=db_devices,
            alias_owner=alias_owner,
            name_owner=name_owner,
            serial_owner=serial_owner,
        )
        bus_id = match.bus_id
        if bus_id is None:
            unmapped_columns.append(
                UnmappedColumn(
                    column_index=col,
                    device_name=str(raw_device),
                    section=str(raw_section),
                    group_name=str(raw_group),
                    label=str(raw_label),
                    reason="snapshot_device_not_found" if match.reason == "no_candidates" else match.reason,
                    normalized_device_name=normalize_device_name(raw_device),
                    closest_match=match.closest_match,
                    confidence=match.confidence,
                    attempted_matches=match.attempted_matches,
                )
            )
            continue
        db_device = db_devices.get(bus_id)
        if not db_device:
            unmapped_columns.append(
                UnmappedColumn(
                    column_index=col,
                    device_name=str(raw_device),
                    section=str(raw_section),
                    group_name=str(raw_group),
                    label=str(raw_label),
                    reason="db_device_not_found",
                    normalized_device_name=normalize_device_name(raw_device),
                    closest_match=match.closest_match,
                    confidence=match.confidence,
                    attempted_matches=match.attempted_matches,
                )
            )
            continue

        lookup_key = (
            section,
            normalize_text(raw_group),
            normalize_text(raw_label),
        )
        def_by_tuple = {
            (
                normalize_text(metric.section),
                normalize_text(metric.group_name or ""),
                normalize_text(metric.label),
            ): metric
            for metric in metrics_by_bus.get(bus_id, [])
        }
        metric = def_by_tuple.get(lookup_key)
        if metric is None:
            unmapped_columns.append(
                UnmappedColumn(
                    column_index=col,
                    device_name=str(raw_device),
                    section=str(raw_section),
                    group_name=str(raw_group),
                    label=str(raw_label),
                    reason="snapshot_metric_not_found",
                    normalized_device_name=normalize_device_name(raw_device),
                    closest_match=match.closest_match,
                    confidence=match.confidence,
                    attempted_matches=match.attempted_matches,
                )
            )
            continue
        column_mappings.append(
            ColumnMapping(
                column_index=col,
                device_id=match.matched_device_id or str(db_device["id"]),
                yacht_id=str(db_device.get("yacht_id", "")),
                definition=metric,
                matched_by=match.matched_by,
                confidence=match.confidence,
            )
        )
    return column_mappings, unmapped_columns, df


def build_dry_run_report(
    snapshot_xml_path: Path,
    datalogger_path: Path,
    db_devices: Dict[int, Dict[str, Any]],
    report_limit: int = 25,
) -> Dict[str, Any]:
    snapshot_devices, metrics_by_bus = parse_snapshot_catalog(snapshot_xml_path)
    mappings, unmapped_columns, dataframe = build_column_mappings_for_catalog(
        datalogger_path=datalogger_path,
        metrics_by_bus=metrics_by_bus,
        snapshot_devices=snapshot_devices,
        db_devices=db_devices,
    )
    by_col = {m.column_index: m for m in mappings}
    method_counts: Dict[str, int] = {}
    for mapping in mappings:
        method_counts[mapping.matched_by] = method_counts.get(mapping.matched_by, 0) + 1
    unresolved_high_confidence = [
        entry.__dict__
        for entry in unmapped_columns
        if entry.reason == "below_confidence_threshold" and 0.85 <= float(entry.confidence) <= 0.92
    ]

    current_rows: Dict[Tuple[str, str], Dict[str, Any]] = {}
    timeseries_rows = 0
    alarm_points = 0

    for _, row in dataframe.iterrows():
        ts_raw = str(row.iloc[0]).strip()
        timestamp = pd.to_datetime(ts_raw, errors="coerce", utc=True)
        if pd.isna(timestamp):
            continue
        for col, mapping in by_col.items():
            raw_value = str(row.iloc[col]) if col < len(row) else ""
            typed = parse_typed_value(raw_value, mapping.definition.value_type)
            if typed.quality == "missing":
                continue
            current_rows[(mapping.device_id, mapping.definition.metric_key)] = {"ok": True}
            if mapping.definition.section == "monitoring":
                timeseries_rows += 1
            elif mapping.definition.section == "alarm":
                alarm_points += 1

    return {
        "columns_total": max(len(dataframe.columns) - 1, 0),
        "columns_mapped": len(mappings),
        "columns_unmapped": len(unmapped_columns),
        "telemetry_current_upserts": len(current_rows),
        "telemetry_timeseries_inserts": timeseries_rows,
        "alarm_points_seen": alarm_points,
        "dry_run": True,
        "matched_by_counts": method_counts,
        "unresolved_high_confidence_candidates": unresolved_high_confidence[: max(report_limit, 0)],
        "mapped_columns": [
            {
                "column_index": m.column_index,
                "metric_key": m.definition.metric_key,
                "matched_device_id": m.device_id,
                "matched_by": m.matched_by,
                "confidence": m.confidence,
            }
            for m in mappings[: max(report_limit, 0)]
        ],
        "unmapped_columns": [entry.__dict__ for entry in unmapped_columns[: max(report_limit, 0)]],
    }


def normalize_text(value: str | None) -> str:
    text = str(value or "").strip().lower()
    return re.sub(r"\s+", " ", text)


def normalize_identity(value: str | None) -> str:
    text = normalize_text(value)
    text = re.sub(r"[/_.-]+", " ", text)
    text = re.sub(r"[^a-z0-9\s]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_device_name(value: str | None) -> str:
    text = normalize_identity(value)
    return re.sub(r"^(bat|chg|inv|com)\s+", "", text).strip()


def identity_variants(value: str | None) -> Tuple[str, ...]:
    base = normalize_identity(value)
    if not base:
        return tuple()
    short = normalize_device_name(value)
    if short and short != base:
        return (base, short)
    return (base,)


def _extract_bus_id_candidate(name: str) -> Optional[int]:
    match = re.search(r"\bbus\s*(\d+)\b", name.lower())
    return int(match.group(1)) if match else None


def _extract_serial_candidate(name: str) -> str:
    return re.sub(r"\s+", "", normalize_identity(name))


def slugify_token(value: str | None) -> str:
    text = normalize_text(value)
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text


def build_metric_key(section: str, group_name: str | None, label: str) -> str:
    section_token = slugify_token(section)
    group_token = slugify_token(group_name)
    label_token = slugify_token(label)

    parts = []
    if section_token == "alarm":
        parts.append("alarm")
    elif group_token:
        parts.append(group_token)
    parts.append(label_token or "metric")
    return ".".join(part for part in parts if part)


def parse_snapshot_catalog(snapshot_xml_path: Path) -> Tuple[Dict[int, SnapshotDevice], Dict[int, List[MetricDefinition]]]:
    tree = ET.parse(snapshot_xml_path)
    root = tree.getroot()
    ps.strip_namespace(root)

    devices: Dict[int, SnapshotDevice] = {}
    metrics_by_bus: Dict[int, List[MetricDefinition]] = {}

    for device in root.iter("device"):
        bus_id = ps.to_int(device.get("BusID"))
        if bus_id is None:
            continue
        strings_map = ps.load_strings_map(device)
        summary = ps.build_device_summary_record(device, bus_id, strings_map)
        aliases = {
            str(summary.get("device_name") or ""),
            str(summary.get("product_name") or ""),
            str(summary.get("product_id") or ""),
            f"device {bus_id}",
        }
        devices[bus_id] = SnapshotDevice(
            bus_id=bus_id,
            display_name=str(summary.get("device_name") or f"Device {bus_id}"),
            product_name=summary.get("product_name"),
            serial_number=summary.get("serial_number"),
            aliases=tuple(sorted(a for a in aliases if a.strip())),
        )

        metric_defs: List[MetricDefinition] = []
        key_counts: Dict[str, int] = {}
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
                visualization_type = ps.to_int(ps.get_child_text(variable, "VisualizationType", ""))
                resolved_type = ps.resolve_type(visualization_type, section_name)
                if resolved_type is None:
                    continue
                text_value_id = ps.to_int(ps.get_child_text(variable, "TextValueID", ""))
                label = strings_map.get(text_value_id, "") if text_value_id is not None else ""
                label = str(label).strip() or "(unknown)"
                unit_string_id = ps.to_int(ps.get_child_text(variable, "UnitStringID", "0"), 0)
                unit = strings_map.get(unit_string_id) if unit_string_id else None
                index = ps.to_int(variable.get("index"))
                group_name = ps.pick_best_group(group_map.get(index, [])) if index is not None else None
                metric_key = build_metric_key(section_name, group_name, label)
                count = key_counts.get(metric_key, 0)
                key_counts[metric_key] = count + 1
                if count:
                    metric_key = f"{metric_key}.{count + 1}"

                metric_defs.append(
                    MetricDefinition(
                        bus_id=bus_id,
                        section=section_name,
                        group_name=group_name,
                        label=label,
                        unit=unit,
                        value_type=resolved_type,
                        metric_key=metric_key,
                    )
                )
        metrics_by_bus[bus_id] = metric_defs

    return devices, metrics_by_bus


def parse_typed_value(raw_value: str, value_type: str) -> TypedValue:
    cleaned = str(raw_value).strip()
    if not cleaned or cleaned == "---":
        return TypedValue(None, None, None, cleaned, "missing")

    if value_type == "numeric":
        try:
            return TypedValue(float(cleaned), None, None, cleaned, "good")
        except ValueError:
            return TypedValue(None, None, None, cleaned, "invalid")
    if value_type == "boolean":
        low = cleaned.lower()
        if low in {"1", "on", "true", "yes"}:
            return TypedValue(None, None, True, cleaned, "good")
        if low in {"0", "off", "false", "no"}:
            return TypedValue(None, None, False, cleaned, "good")
        return TypedValue(None, None, None, cleaned, "invalid")
    return TypedValue(None, cleaned, None, cleaned, "good")


class TelemetryIngestor:
    def __init__(self, database_url: str, yacht_id: str) -> None:
        self.engine = create_engine(database_url)
        self.yacht_id = yacht_id
        self.metadata = MetaData()
        self.telemetry_current = Table("telemetry_current", self.metadata, autoload_with=self.engine, schema="public")
        self.telemetry_timeseries = Table("telemetry_timeseries", self.metadata, autoload_with=self.engine, schema="public")
        self.alarm_current = Table("alarm_current", self.metadata, autoload_with=self.engine, schema="public")
        self.alarm_events = Table("alarm_events", self.metadata, autoload_with=self.engine, schema="public")
        self.devices = Table("devices", self.metadata, autoload_with=self.engine, schema="public")
        try:
            self.device_aliases = Table("device_aliases", self.metadata, autoload_with=self.engine, schema="public")
        except Exception:
            self.device_aliases = None

    def resolve_device_map(self, snapshot_devices: Dict[int, SnapshotDevice]) -> Dict[int, Dict[str, Any]]:
        bus_ids = list(snapshot_devices.keys())
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(
                    self.devices.c.id,
                    self.devices.c.bus_id,
                    self.devices.c.display_name,
                    self.devices.c.product_name,
                    self.devices.c.serial_number,
                ).where(self.devices.c.yacht_id == self.yacht_id, self.devices.c.bus_id.in_(bus_ids))
            ).mappings()
            return {int(row["bus_id"]): dict(row) for row in rows}

    def resolve_aliases_by_bus(self, db_devices: Dict[int, Dict[str, Any]]) -> Dict[int, List[str]]:
        alias_map: Dict[int, List[str]] = {bus_id: [] for bus_id in db_devices.keys()}
        if not self.device_aliases or not db_devices:
            return alias_map
        id_to_bus = {str(device["id"]): bus_id for bus_id, device in db_devices.items()}
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(self.device_aliases.c.device_id, self.device_aliases.c.alias).where(
                    self.device_aliases.c.device_id.in_(list(id_to_bus.keys()))
                )
            ).mappings()
            for row in rows:
                bus_id = id_to_bus.get(str(row["device_id"]))
                if bus_id is not None and row.get("alias"):
                    alias_map[bus_id].append(str(row["alias"]))
        return alias_map

    def upsert_snapshot_aliases(self, snapshot_devices: Dict[int, SnapshotDevice], db_devices: Dict[int, Dict[str, Any]]) -> None:
        if not self.device_aliases:
            return
        rows: List[Dict[str, Any]] = []
        for bus_id, snapshot in snapshot_devices.items():
            device = db_devices.get(bus_id)
            if not device:
                continue
            aliases = set(snapshot.aliases)
            if snapshot.serial_number:
                aliases.add(snapshot.serial_number)
            for alias in aliases:
                normalized = normalize_identity(alias)
                if not normalized:
                    continue
                rows.append(
                    {
                        "device_id": str(device["id"]),
                        "alias": alias.strip(),
                        "normalized_alias": normalized,
                        "source": "snapshot_xml",
                    }
                )
        if not rows:
            return
        with self.engine.begin() as conn:
            stmt = pg_insert(self.device_aliases).values(rows)
            conn.execute(stmt.on_conflict_do_nothing(index_elements=["normalized_alias"]))

    def _build_column_mappings(
        self,
        datalogger_path: Path,
        metrics_by_bus: Dict[int, List[MetricDefinition]],
        snapshot_devices: Dict[int, SnapshotDevice],
        db_devices: Dict[int, Dict[str, Any]],
    ) -> Tuple[List[ColumnMapping], List[UnmappedColumn], pd.DataFrame]:
        return build_column_mappings_for_catalog(
            datalogger_path=datalogger_path,
            metrics_by_bus=metrics_by_bus,
            snapshot_devices=snapshot_devices,
            db_devices={k: {**v, "yacht_id": self.yacht_id} for k, v in db_devices.items()},
        )

    def ingest(self, snapshot_xml_path: Path, datalogger_path: Path, *, dry_run: bool = False, report_limit: int = 25) -> Dict[str, Any]:
        snapshot_devices, metrics_by_bus = parse_snapshot_catalog(snapshot_xml_path)
        db_devices = self.resolve_device_map(snapshot_devices)
        alias_map = self.resolve_aliases_by_bus(db_devices)
        db_devices_with_aliases = {bus_id: {**device, "aliases": alias_map.get(bus_id, [])} for bus_id, device in db_devices.items()}
        if not dry_run:
            self.upsert_snapshot_aliases(snapshot_devices, db_devices)
        mappings, unmapped_columns, dataframe = self._build_column_mappings(
            datalogger_path,
            metrics_by_bus,
            snapshot_devices,
            db_devices_with_aliases,
        )
        by_col = {m.column_index: m for m in mappings}

        current_rows: Dict[Tuple[str, str], Dict[str, Any]] = {}
        timeseries_rows: List[Dict[str, Any]] = []
        alarm_values: List[Tuple[ColumnMapping, datetime, TypedValue]] = []

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
                    "source_timestamp": ts,
                    "updated_at": datetime.now(timezone.utc),
                }
                current_rows[(mapping.device_id, mapping.definition.metric_key)] = current_payload

                if mapping.definition.section == "monitoring":
                    timeseries_rows.append(
                        {
                            "yacht_id": mapping.yacht_id,
                            "device_id": mapping.device_id,
                            "metric_key": mapping.definition.metric_key,
                            "ts": ts,
                            "numeric_value": typed.numeric_value,
                            "text_value": typed.text_value,
                            "bool_value": typed.bool_value,
                            "raw_value": typed.raw_value,
                            "quality": typed.quality,
                        }
                    )
                elif mapping.definition.section == "alarm":
                    alarm_values.append((mapping, ts, typed))

        report: Dict[str, Any] = {
            "columns_total": max(len(dataframe.columns) - 1, 0),
            "columns_mapped": len(mappings),
            "columns_unmapped": len(unmapped_columns),
            "telemetry_current_upserts": len(current_rows),
            "telemetry_timeseries_inserts": len(timeseries_rows),
            "alarm_points_seen": len(alarm_values),
            "dry_run": dry_run,
            "matched_by_counts": {
                key: sum(1 for m in mappings if m.matched_by == key)
                for key in sorted({m.matched_by for m in mappings})
            },
            "unresolved_high_confidence_candidates": [
                entry.__dict__
                for entry in unmapped_columns
                if entry.reason == "below_confidence_threshold" and 0.85 <= float(entry.confidence) <= 0.92
            ][: max(report_limit, 0)],
            "unmapped_columns": [entry.__dict__ for entry in unmapped_columns[: max(report_limit, 0)]],
        }
        if dry_run:
            return report

        with self.engine.begin() as conn:
            if current_rows:
                stmt = pg_insert(self.telemetry_current).values(list(current_rows.values()))
                update_cols = {
                    col: getattr(stmt.excluded, col)
                    for col in (
                        "section",
                        "group_name",
                        "label",
                        "unit",
                        "value_type",
                        "numeric_value",
                        "text_value",
                        "bool_value",
                        "raw_value",
                        "quality",
                        "source_timestamp",
                        "updated_at",
                    )
                }
                conn.execute(stmt.on_conflict_do_update(index_elements=["device_id", "metric_key"], set_=update_cols))

            if timeseries_rows:
                conn.execute(pg_insert(self.telemetry_timeseries).values(timeseries_rows))

            self._apply_alarm_changes(conn, alarm_values)
        return report

    def _apply_alarm_changes(self, conn: Any, alarm_values: Iterable[Tuple[ColumnMapping, datetime, TypedValue]]) -> None:
        alarm_values = list(alarm_values)
        if not alarm_values:
            return

        keys = {(m.device_id, m.definition.metric_key) for m, _, _ in alarm_values}
        existing = conn.execute(
            select(
                self.alarm_current.c.device_id,
                self.alarm_current.c.metric_key,
                self.alarm_current.c.active,
                self.alarm_current.c.first_triggered_at,
                self.alarm_current.c.last_changed_at,
            ).where(self.alarm_current.c.yacht_id == self.yacht_id)
        ).mappings()
        state_map: Dict[Tuple[str, str], Dict[str, Any]] = {
            (str(r["device_id"]), str(r["metric_key"])): dict(r) for r in existing if (str(r["device_id"]), str(r["metric_key"])) in keys
        }

        current_upserts: Dict[Tuple[str, str], Dict[str, Any]] = {}
        events: List[Dict[str, Any]] = []

        for mapping, ts, typed in alarm_values:
            if typed.bool_value is None:
                continue
            key = (mapping.device_id, mapping.definition.metric_key)
            previous = state_map.get(key)
            prev_state = previous["active"] if previous else None
            new_state = bool(typed.bool_value)
            changed = previous is not None and prev_state != new_state

            first_triggered = previous["first_triggered_at"] if previous else None
            if new_state and first_triggered is None:
                first_triggered = ts
            if changed and new_state:
                first_triggered = ts
            if changed:
                events.append(
                    {
                        "yacht_id": mapping.yacht_id,
                        "device_id": mapping.device_id,
                        "metric_key": mapping.definition.metric_key,
                        "event_type": "triggered" if new_state else "cleared",
                        "previous_state": prev_state,
                        "new_state": new_state,
                        "ts": ts,
                        "start_time": ts,
                        "end_time": ts if not new_state else None,
                        "metadata": {
                            "label": mapping.definition.label,
                            "group_name": mapping.definition.group_name,
                            "raw_value": typed.raw_value,
                        },
                    }
                )
            current_upserts[key] = {
                "yacht_id": mapping.yacht_id,
                "device_id": mapping.device_id,
                "metric_key": mapping.definition.metric_key,
                "active": new_state,
                "severity": None,
                "message": mapping.definition.label,
                "first_triggered_at": first_triggered,
                "last_changed_at": ts if changed or previous is None else previous["last_changed_at"],
                "last_seen_at": ts,
            }
            state_map[key] = {"active": new_state, "first_triggered_at": first_triggered, "last_changed_at": ts}

        if current_upserts:
            stmt = pg_insert(self.alarm_current).values(list(current_upserts.values()))
            update_cols = {
                col: getattr(stmt.excluded, col)
                for col in (
                    "active",
                    "severity",
                    "message",
                    "first_triggered_at",
                    "last_changed_at",
                    "last_seen_at",
                )
            }
            conn.execute(stmt.on_conflict_do_update(index_elements=["device_id", "metric_key"], set_=update_cols))
        if events:
            conn.execute(pg_insert(self.alarm_events).values(events))
