# Development Setup

## Frontend

Use `.env.local` for frontend runtime values.

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Optional:

- `NEXT_PUBLIC_USE_JSONL_FALLBACK=true` for local fixture-only mode.

## Backend

Use `backend/.env`.

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `PORT`
- `YACHT_ID` for `npm run ingest:sample`

## Local Fixture Data

`data/` exists for development fallback only.
Production data flow should use Supabase as primary source.
