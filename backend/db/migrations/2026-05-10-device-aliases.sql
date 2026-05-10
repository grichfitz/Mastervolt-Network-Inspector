-- Device identity alias registry (non-breaking)
-- Supports resilient datalogger label -> device resolution.

begin;

create table if not exists public.device_aliases (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint device_aliases_normalized_alias_unique unique (normalized_alias)
);

create index if not exists idx_device_aliases_normalized_alias
  on public.device_aliases (normalized_alias);
create index if not exists idx_device_aliases_device_id
  on public.device_aliases (device_id);

commit;
