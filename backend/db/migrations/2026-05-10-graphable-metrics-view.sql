begin;

create or replace view public.graphable_metrics as
select
  t.metric_key,
  count(*)::bigint as sample_count,
  min(t.ts) as first_seen,
  max(t.ts) as last_seen
from public.telemetry_timeseries t
where t.numeric_value is not null
  and t.metric_key not like 'installer_menu.%'
  and t.metric_key not like 'debug.%'
  and t.metric_key not like 'diskstatus.%'
  and t.metric_key not like '%.date'
  and t.metric_key not like '%.time'
  and t.metric_key not in (
    'general.date',
    'general.time',
    'general.device_name',
    'general.serial_number',
    'general.product_name',
    'general.software_version',
    'general.firmware_version',
    'general.ip_address',
    'general.mac_address'
  )
group by t.metric_key;

commit;
