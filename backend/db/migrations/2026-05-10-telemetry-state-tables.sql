-- Telemetry state extension (non-breaking)
-- Adds monitoring/history/alarm state tables without changing existing tables.

begin;

create table if not exists public.telemetry_current (
  yacht_id uuid not null references public.yachts (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  metric_key text not null,
  section text not null,
  group_name text,
  label text not null,
  unit text,
  value_type text not null,
  numeric_value double precision,
  text_value text,
  bool_value boolean,
  raw_value text,
  quality text not null default 'good',
  source_timestamp timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint telemetry_current_pk primary key (device_id, metric_key)
);

create index if not exists idx_telemetry_current_yacht_id
  on public.telemetry_current (yacht_id);
create index if not exists idx_telemetry_current_updated_at_desc
  on public.telemetry_current (updated_at desc);

create table if not exists public.telemetry_timeseries (
  id bigserial primary key,
  yacht_id uuid not null references public.yachts (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  metric_key text not null,
  ts timestamptz not null,
  numeric_value double precision,
  text_value text,
  bool_value boolean,
  raw_value text,
  quality text not null default 'good'
);

create index if not exists idx_telemetry_timeseries_device_metric_ts_desc
  on public.telemetry_timeseries (device_id, metric_key, ts desc);
create index if not exists idx_telemetry_timeseries_yacht_ts_desc
  on public.telemetry_timeseries (yacht_id, ts desc);

create table if not exists public.alarm_current (
  yacht_id uuid not null references public.yachts (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  metric_key text not null,
  active boolean not null,
  severity text,
  message text,
  first_triggered_at timestamptz,
  last_changed_at timestamptz not null,
  last_seen_at timestamptz not null,
  constraint alarm_current_pk primary key (device_id, metric_key)
);

create index if not exists idx_alarm_current_yacht_id
  on public.alarm_current (yacht_id);
create index if not exists idx_alarm_current_active
  on public.alarm_current (active);

create table if not exists public.alarm_events (
  id bigserial primary key,
  yacht_id uuid not null references public.yachts (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  metric_key text not null,
  event_type text not null check (event_type in ('triggered', 'cleared')),
  previous_state boolean,
  new_state boolean not null,
  ts timestamptz not null,
  start_time timestamptz,
  end_time timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_alarm_events_yacht_id
  on public.alarm_events (yacht_id);
create index if not exists idx_alarm_events_device_id
  on public.alarm_events (device_id);
create index if not exists idx_alarm_events_ts_desc
  on public.alarm_events (ts desc);

commit;
