"use client";

type DeviceOption = {
  id: string;
  busId: number;
  name: string;
};

type MetricOption = {
  metricKey: string;
};

type RangeOption = {
  key: string;
  label: string;
};

type Props = {
  devices: DeviceOption[];
  metrics: MetricOption[];
  selectedDeviceId?: string;
  selectedMetricKey?: string;
  selectedRangeKey: string;
  selectedLimit: number;
  rangeOptions: RangeOption[];
};

export default function TelemetryGraphFilters({
  devices,
  metrics,
  selectedDeviceId,
  selectedMetricKey,
  selectedRangeKey,
  selectedLimit,
  rangeOptions
}: Props) {
  return (
    <form className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 md:grid-cols-4" method="get">
      <label className="space-y-1">
        <span className="text-xs uppercase tracking-wide text-slate-400">Device</span>
        <select
          name="device_id"
          defaultValue={selectedDeviceId}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        >
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              Bus {device.busId} - {device.name}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-xs uppercase tracking-wide text-slate-400">Metric</span>
        <select
          name="metric_key"
          defaultValue={selectedMetricKey}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        >
          {metrics.map((metric) => (
            <option key={metric.metricKey} value={metric.metricKey}>
              {metric.metricKey}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-xs uppercase tracking-wide text-slate-400">Range</span>
        <select name="range" defaultValue={selectedRangeKey} className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
          {rangeOptions.map((range) => (
            <option key={range.key} value={range.key}>
              {range.label}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-xs uppercase tracking-wide text-slate-400">Limit</span>
        <input
          type="number"
          name="limit"
          min={1}
          max={5000}
          defaultValue={selectedLimit}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        />
      </label>

      <button
        type="submit"
        className="md:col-span-4 w-full rounded-md border border-cyan-700 bg-cyan-900/40 px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-900/60"
      >
        Update graph
      </button>
    </form>
  );
}
