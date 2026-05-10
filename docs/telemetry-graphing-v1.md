# Telemetry Graphing V1

## API endpoints

- `GET /api/telemetry/graphable-metrics`
- `GET /api/telemetry/history`
- `GET /api/telemetry/current`

## Example queries

```bash
curl "http://localhost:3001/api/telemetry/graphable-metrics?yacht_id=<yacht-uuid>&device_id=<device-uuid>&limit=200"
```

```bash
curl "http://localhost:3001/api/telemetry/history?yacht_id=<yacht-uuid>&device_id=<device-uuid>&metric_key=output.battery_voltage&start=2026-05-09T12:00:00Z&end=2026-05-10T12:00:00Z&limit=5000"
```

```bash
curl "http://localhost:3001/api/telemetry/current?yacht_id=<yacht-uuid>&device_id=<device-uuid>&metric_key=output.battery_voltage"
```

## Notes

- History responses return only numeric values (`ts`, `value`) from `telemetry_timeseries`.
- Defaults are applied in history when `start`, `end`, or `limit` are omitted (24h, now, 5000).
- Excluded metric patterns include `installer_menu.*`, `debug.*`, `diskstatus.*`, `*.date`, and `*.time`.

## Future scaling (intentionally deferred)

- Add downsampling for long ranges (bucketed average/min/max).
- Add pagination/cursor support for very dense datasets.
- Cache graphable metric lists per `(yacht_id, device_id)` when cardinality grows.
- Add comparative multi-metric overlays after single-metric validation is complete.
