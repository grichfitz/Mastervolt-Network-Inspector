# Mastervolt Fleet Telemetry Platform

Production-style multi-yacht telemetry platform for Mastervolt ecosystems.

## Purpose

This repository supports:

- Multi-yacht fleet metadata management
- Yacht-scoped device exploration
- Structured variable definition management
- Historical telemetry ingestion foundations

## Repository Structure

- `app/`, `components/`, `lib/` - Next.js frontend
- `backend/` - API + ingestion runtime
  - `backend/ingest/` - canonical ingestion parsers/services
  - `backend/db/` - schema + migrations + seed snippets
- `config/` - shared config and example yacht config
- `docs/` - architecture and operational notes
- `legacy/` - archived prototype artifacts
- `data/` - local dev fixtures only (JSONL fallback)

## Core Architecture

Stable principles:

- Yacht is top-level telemetry owner
- Device metadata is separate from telemetry
- Variable definitions are separate from telemetry facts
- Routing hierarchy is yacht-scoped:
  - `/yachts`
  - `/yachts/[yachtSlug]`
  - `/yachts/[yachtSlug]/devices/[deviceId]`

## Metadata vs Telemetry

- `snapshot.xml`:
  - metadata/schema discovery only
  - device and variable definition synchronization
- `datalogger.txt`:
  - operational telemetry ingestion
  - historical time-series source

See also: `docs/architecture-notes.md`

## Frontend Data Flow

Primary:

- Supabase (`yachts`, `devices`, `variable_definitions`)

Fallback (dev/testing):

- JSONL fixture mode via `NEXT_PUBLIC_USE_JSONL_FALLBACK=true`

The UI contract is unchanged regardless of source.

## Environment Setup

### Frontend (`.env.local`)

Use `.env.local.example`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_USE_JSONL_FALLBACK` (optional)

### Backend (`backend/.env`)

Use `backend/.env.example`:

- `PORT`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `YACHT_ID` (optional helper script)

## Development

### Frontend

```bash
npm install
npm run dev
```

### Backend

```bash
cd backend
npm install
npm run dev
```

## Ingestion Pipeline

- API ingestion services are implemented in `backend/ingest/services/`
- Parsers are implemented in `backend/ingest/parsers/`
- Legacy import paths in `backend/src/services` and `backend/src/parsers` remain as wrappers for compatibility

## Database

Canonical schema:

- `backend/db/schema.sql`

Includes:

- `yachts`
- `devices`
- `variable_definitions`
- `device_current_values`
- `telemetry`

## Next Recommended Development Steps

1. Implement telemetry writes to `device_current_values` alongside `telemetry`.
2. Add backend endpoint/service for variable definition refresh by product.
3. Add Supabase RLS policies by `yacht_id`.
4. Add realtime subscriptions for device current values in frontend.
5. Add integration tests for ingestion idempotency and conflict behavior.
