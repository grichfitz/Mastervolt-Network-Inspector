-- Mastervolt Logging integrity amendments
-- Apply to an existing database.

begin;

-- 1) Fix telemetry uniqueness when variable_id can be NULL.
alter table telemetry drop constraint if exists telemetry_unique_key;
drop index if exists telemetry_timestamp_device_id_variable_id_key;
drop index if exists telemetry_unique_timestamp_device_variable_idx;
create unique index if not exists telemetry_unique_timestamp_device_index_idx
  on telemetry ("timestamp", device_id, read_only_index);

-- 2) Add raw_key support on variables and index it.
alter table variables add column if not exists raw_key text;
create index if not exists idx_variables_raw_key on variables (raw_key);

-- Compatibility: older schema versions may still have a legacy "key" column
-- with NOT NULL. Drop NOT NULL so raw_key-based inserts are not blocked.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_name = 'variables'
      and column_name = 'key'
  ) then
    execute 'alter table variables alter column key drop not null';
  end if;
end $$;

-- 3) Allow NULL product_id for global default mapping rows.
alter table variable_mapping alter column product_id drop not null;

commit;
