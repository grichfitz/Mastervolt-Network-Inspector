import { notFound } from "next/navigation";

import Breadcrumbs from "@/components/Breadcrumbs";
import TelemetryGraphFilters from "@/components/TelemetryGraphFilters";
import TelemetryLineChart from "@/components/TelemetryLineChart";
import {
  getGraphableMetricsForDevice,
  getTelemetryCurrent,
  getTelemetryGraphDevicesForYacht,
  getTelemetryHistory,
  getYachtBySlug
} from "@/lib/data";

const RANGE_OPTIONS = [
  { key: "1h", label: "Last 1h", ms: 1 * 60 * 60 * 1000 },
  { key: "6h", label: "Last 6h", ms: 6 * 60 * 60 * 1000 },
  { key: "24h", label: "Last 24h", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "Last 7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All dates", ms: null }
] as const;

const PRIORITY_METRICS = [
  "output.battery_voltage",
  "output.battery_current",
  "general.charger_temp",
  "general.state",
  "general.device_state"
];

type PageProps = {
  params: Promise<{ yachtSlug: string }>;
  searchParams: Promise<{ device_id?: string; metric_key?: string; range?: string; limit?: string }>;
};

function pickRange(key: string | undefined) {
  return RANGE_OPTIONS.find((option) => option.key === key) ?? RANGE_OPTIONS[2];
}

function pickMetric(available: string[], selected: string | undefined): string {
  if (selected && available.includes(selected)) return selected;
  for (const key of PRIORITY_METRICS) {
    if (available.includes(key)) return key;
  }
  return available[0] ?? "";
}

export default async function TelemetryPage({ params, searchParams }: PageProps) {
  const { yachtSlug } = await params;
  const yacht = await getYachtBySlug(decodeURIComponent(yachtSlug));
  if (!yacht) notFound();

  const query = await searchParams;
  const devices = await getTelemetryGraphDevicesForYacht(yacht);
  const selectedDeviceId = query.device_id && devices.some((d) => d.id === query.device_id) ? query.device_id : devices[0]?.id;
  const selectedRange = pickRange(query.range);
  const selectedLimit = Math.min(Math.max(Number(query.limit || 5000), 1), 5000);

  const metrics = selectedDeviceId ? await getGraphableMetricsForDevice(yacht.id, selectedDeviceId) : [];
  const metricKeys = metrics.map((metric) => metric.metricKey);
  const selectedMetricKey = pickMetric(metricKeys, query.metric_key);
  const selectedMetric = metrics.find((metric) => metric.metricKey === selectedMetricKey);

  const end = selectedRange.key === "all" && selectedMetric?.lastSeen ? new Date(selectedMetric.lastSeen) : new Date();
  const start =
    selectedRange.key === "all"
      ? new Date(selectedMetric?.firstSeen ?? new Date(end.getTime() - 24 * 60 * 60 * 1000))
      : new Date(end.getTime() - selectedRange.ms);
  const startIso = Number.isNaN(start.getTime()) ? new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString() : start.toISOString();
  const endIso = Number.isNaN(end.getTime()) ? new Date().toISOString() : end.toISOString();

  const [history, current] =
    selectedDeviceId && selectedMetricKey
      ? await Promise.all([
          getTelemetryHistory({
            yachtId: yacht.id,
            deviceId: selectedDeviceId,
            metricKey: selectedMetricKey,
            start: startIso,
            end: endIso,
            limit: selectedLimit
          }),
          getTelemetryCurrent({
            yachtId: yacht.id,
            deviceId: selectedDeviceId,
            metricKey: selectedMetricKey
          })
        ])
      : [[], null];

  return (
    <section className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Yachts", href: "/yachts" },
          { label: yacht.name, href: `/yachts/${encodeURIComponent(yacht.slug)}` },
          { label: "Telemetry graph" }
        ]}
      />

      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-100">Telemetry validation graph</h1>
        <p className="text-sm text-slate-400">Use this view to validate timestamp quality, normalization, and ingestion stability.</p>
      </div>

      <TelemetryGraphFilters
        devices={devices}
        metrics={metrics}
        selectedDeviceId={selectedDeviceId}
        selectedMetricKey={selectedMetricKey}
        selectedRangeKey={selectedRange.key}
        selectedLimit={selectedLimit}
        rangeOptions={RANGE_OPTIONS.map((range) => ({ key: range.key, label: range.label }))}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Samples</p>
          <p className="mt-1 font-mono text-lg text-slate-100">{history.length}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 md:col-span-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Latest current value</p>
          <p className="mt-1 text-sm text-slate-100">
            {current ? (
              <>
                <span className="font-mono">{current.value}</span> at <span className="font-mono">{new Date(current.ts).toLocaleString()}</span>
              </>
            ) : (
              "No current value for selected metric"
            )}
          </p>
        </div>
      </div>

      <TelemetryLineChart data={history} />
    </section>
  );
}
