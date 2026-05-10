# Backend Ingestion

This folder is the canonical ingestion boundary for backend runtime code.

## Structure

- `parsers/`
  - `snapshotParser.js`: parses `snapshot.xml` metadata/device identity.
  - `dataloggingParser.js`: parses `datalogging.txt` telemetry rows.
- `services/`
  - `snapshotIngestService.js`: upserts yacht device metadata from snapshot payload.
  - `telemetryIngestService.js`: ingests telemetry rows from datalogging payload.

## Notes

- API entrypoints in `backend/src/routes/api.js` call these services.
- `backend/src/parsers/*` and `backend/src/services/*` are compatibility wrappers.
- `snapshot.xml` is metadata/schema discovery only, not telemetry history.
