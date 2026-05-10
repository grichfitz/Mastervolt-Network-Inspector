# Telemetry Extension Notes

## Scope

This extension adds telemetry state handling without replacing existing platform schema, API routes, or ingestion wrappers.

Added tables:

- `telemetry_current`
- `telemetry_timeseries`
- `alarm_current`
- `alarm_events`

Existing tables remain unchanged (`yachts`, `devices`, `variable_definitions`, `device_current_values`, `telemetry`).

## Migration

Run:

```sql
\i backend/db/migrations/2026-05-10-telemetry-state-tables.sql
\i backend/db/migrations/2026-05-10-device-aliases.sql
```

Or apply via your normal migration runner.

## Python Ingestion Command

```bash
pip install -r requirements-snapshot-ingest.txt
python ingest_telemetry.py --snapshot snapshot.xml --datalogger DataLogger.txt --yacht-id <uuid> --database-url "$DATABASE_URL"
```

Dry-run/report mode:

```bash
python ingest_telemetry.py --dry-run --report-limit 50 --snapshot snapshot.xml --datalogger DataLogger.txt --yacht-id <uuid> --database-url "$DATABASE_URL"
```

Environment loading:

- `ingest_telemetry.py` automatically reads both `.env` and `backend/.env`.
- If `YACHT_ID` and `DATABASE_URL` are present there, you can run:

```bash
python ingest_telemetry.py --dry-run --report-limit 50
```

## Classification Rules Implemented

- Monitoring: upsert latest to `telemetry_current`, append to `telemetry_timeseries`.
- History: upsert latest to `telemetry_current` only.
- Alarm: update `alarm_current`; write `alarm_events` only on state changes.
- Configuration and events sections from datalogger headers are ignored.

## Device Identity Resolution

- Added `device_aliases` table for canonical alias lookup.
- Device matching order:
  1) alias exact
  2) device name exact
  3) bus id exact
  4) serial exact
  5) fuzzy fallback (confidence-scored)
  6) unresolved report
- Dry-run now includes:
  - `matched_by_counts`
  - per-column `matched_by` + `confidence` samples
  - unmapped diagnostics (`normalized_device_name`, `closest_match`, `attempted_matches`, `reason`)
