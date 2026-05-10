# Architecture Notes

## Data Source Roles

### `snapshot.xml`

Use for:

- Device metadata discovery
- Product/variable schema discovery
- Variable definition synchronization

Do not use for:

- Historical telemetry
- Dashboard "current stream" semantics

### `datalogger.txt`

Use for:

- Operational telemetry ingestion
- Historical time-series inserts
- Future current-value updates

## Separation Model

- `devices`: metadata identity per yacht
- `variable_definitions`: semantic decoding layer
- `device_current_values`: low-latency latest state (future write path)
- `telemetry`: append-oriented historical facts

## Ownership Model

Yacht is platform-owned and explicit:

- Never inferred from parser output
- Applied by API/ingestion context
- Used for tenancy, filtering, and future RLS
