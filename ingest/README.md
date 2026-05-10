# Python Ingestion Scripts

Top-level Python ingestion utilities for metadata processing.

- `snapshot_ingest.py` (root): Supabase metadata sync runner.
- `parse_snapshot.py` (root): XML-to-JSONL parser utility for local/dev fixtures.

This folder is reserved for Python ingestion tooling organization.
Existing script entrypoints are kept at repo root for backward compatibility.

## Telemetry Ingestion Extension

- `ingest_telemetry.py` (root): snapshot-driven telemetry ingestion entrypoint.
- `ingest/telemetry_pipeline.py`: reusable parser and SQL writer module.

Behavior:

- Uses `snapshot.xml` as authoritative metric definitions.
- Reads `DataLogger.txt` for sampled values.
- Writes:
  - monitoring -> `telemetry_current` and `telemetry_timeseries`
  - history -> `telemetry_current` only
  - alarm state transitions -> `alarm_events` and `alarm_current`
