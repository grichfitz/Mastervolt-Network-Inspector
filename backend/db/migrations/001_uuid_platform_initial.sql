-- Migration 001 ? greenfield UUID platform (mirror of backend/db/schema.sql).
-- =============================================================================
-- Mastervolt multi-yacht telemetry platform ? PostgreSQL / Supabase (UUID keys)
-- Hierarchy: yachts ? devices ? variable_definitions ? device_current_values | telemetry
--
-- Snapshot XML is metadata/schema discovery only ? no telemetry history here.
-- Yacht rows are created explicitly (platform ownership); never inferred from XML.
--
-- Express backend under backend/src may still reference legacy bigint tables until
-- aligned to this schema.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- updated_at maintenance (yachts, devices)
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. yachts ? top-level telemetry owner
-- -----------------------------------------------------------------------------
create table if not exists public.yachts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint yachts_slug_format check (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and length(slug) >= 2
    and length(slug) <= 64
  )
);

create index if not exists idx_yachts_created_at on public.yachts (created_at desc);

drop trigger if exists trg_yachts_updated_at on public.yachts;
create trigger trg_yachts_updated_at
  before update on public.yachts
  for each row execute function public.set_updated_at();

comment on table public.yachts is 'Platform tenant; all telemetry and devices are scoped by yacht_id for RLS and partitioning.';

-- -----------------------------------------------------------------------------
-- 2. devices ? onboard units per yacht (stable bus_id per yacht)
-- -----------------------------------------------------------------------------
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  yacht_id uuid not null references public.yachts (id) on delete cascade,
  bus_id bigint not null,
  product_id text,
  display_name text,
  product_name text,
  serial_number text,
  firmware_version text,
  software_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devices_yacht_bus_unique unique (yacht_id, bus_id)
);

create index if not exists idx_devices_yacht_id on public.devices (yacht_id);
create index if not exists idx_devices_product_id on public.devices (product_id) where product_id is not null;

drop trigger if exists trg_devices_updated_at on public.devices;
create trigger trg_devices_updated_at
  before update on public.devices
  for each row execute function public.set_updated_at();

comment on table public.devices is 'Physical/logical Mastervolt devices; display names may change; identity is yacht_id + bus_id.';

-- -----------------------------------------------------------------------------
-- 3. variable_definitions ? semantic registry (decode telemetry by product + index)
-- -----------------------------------------------------------------------------
create table if not exists public.variable_definitions (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  variable_index integer not null,
  section text not null,
  group_name text,
  label text not null,
  unit text,
  data_type text not null,
  writeable boolean not null default false,
  created_at timestamptz not null default now(),
  constraint variable_definitions_product_index_unique unique (product_id, variable_index)
);

create index if not exists idx_variable_definitions_product_id on public.variable_definitions (product_id);
create index if not exists idx_variable_definitions_variable_index on public.variable_definitions (variable_index);
create index if not exists idx_variable_definitions_section on public.variable_definitions (section);

comment on table public.variable_definitions is 'Catalog of variables per product_id + variable_index; separates meaning from time-series storage.';

-- -----------------------------------------------------------------------------
-- 4. device_current_values ? latest value per device + definition (dashboard / realtime)
-- -----------------------------------------------------------------------------
create table if not exists public.device_current_values (
  id uuid primary key default gen_random_uuid(),
  yacht_id uuid not null references public.yachts (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  variable_definition_id uuid not null references public.variable_definitions (id) on delete cascade,
  value text not null,
  updated_at timestamptz not null default now(),
  constraint device_current_values_device_def_unique unique (device_id, variable_definition_id)
);

create index if not exists idx_device_current_values_yacht_id on public.device_current_values (yacht_id);
create index if not exists idx_device_current_values_device_id on public.device_current_values (device_id);
create index if not exists idx_device_current_values_updated_at on public.device_current_values (updated_at desc);

comment on table public.device_current_values is 'Fast path for latest values; fed by ingest/realtime writers separate from append-only telemetry.';

-- -----------------------------------------------------------------------------
-- 5. telemetry ? append-only historical samples (Timescale / partition-ready)
-- -----------------------------------------------------------------------------
create table if not exists public.telemetry (
  id uuid primary key default gen_random_uuid(),
  yacht_id uuid not null references public.yachts (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  variable_definition_id uuid not null references public.variable_definitions (id) on delete cascade,
  "timestamp" timestamptz not null,
  value text not null
);

-- Primary query paths: fleet by yacht + time; device drill-down; series by definition
create index if not exists idx_telemetry_yacht_timestamp on public.telemetry (yacht_id, "timestamp" desc);
create index if not exists idx_telemetry_device_timestamp on public.telemetry (device_id, "timestamp" desc);
create index if not exists idx_telemetry_vardef_timestamp on public.telemetry (variable_definition_id, "timestamp" desc);
create index if not exists idx_telemetry_timestamp_brin on public.telemetry using brin ("timestamp");

comment on table public.telemetry is 'Append-only history; duplicate yacht_id enables partition pruning and RLS without joining devices.';

-- -----------------------------------------------------------------------------
-- Future RLS (enable after auth): policy patterns use yacht_id on all tenant tables.
-- Example (do not enable until auth exists):
--   alter table public.telemetry enable row level security;
--   create policy "read_own_yacht" on public.telemetry for select using (yacht_id = ...);
-- -----------------------------------------------------------------------------
