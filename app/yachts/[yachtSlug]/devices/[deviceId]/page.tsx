import Link from "next/link";
import { notFound } from "next/navigation";

import Breadcrumbs from "@/components/Breadcrumbs";
import DeviceSummaryPanel from "@/components/DeviceSummaryPanel";
import SectionAccordion from "@/components/SectionAccordion";
import { getDeviceForYacht, getYachtBySlug } from "@/lib/data";

const TELEMETRY_SECTIONS = [
  { key: "monitoring" as const, title: "Monitoring" },
  { key: "alarm" as const, title: "Alarm" },
  { key: "history" as const, title: "History" }
];

type PageProps = {
  params: Promise<{ yachtSlug: string; deviceId: string }>;
  searchParams: Promise<{ q?: string }>;
};

function filterVariables<T extends { label: string; group?: string; index: number }>(items: T[], query: string): T[] {
  if (!query) return items;
  return items.filter(
    (variable) =>
      variable.label.toLowerCase().includes(query) ||
      variable.group?.toLowerCase().includes(query) ||
      String(variable.index).includes(query)
  );
}

export default async function YachtDeviceDetailPage({ params, searchParams }: PageProps) {
  const { yachtSlug, deviceId } = await params;
  const { q = "" } = await searchParams;
  const query = q.trim().toLowerCase();

  const yacht = await getYachtBySlug(decodeURIComponent(yachtSlug));
  if (!yacht) {
    notFound();
  }

  const device = await getDeviceForYacht(yacht, decodeURIComponent(deviceId));
  if (!device) {
    notFound();
  }

  const filteredTelemetry = {
    monitoring: filterVariables(device.monitoring, query),
    alarm: filterVariables(device.alarm, query),
    history: filterVariables(device.history, query)
  };

  const telemetryFlat = [...device.monitoring, ...device.alarm, ...device.history];
  const totalTelemetry = telemetryFlat.length;
  const totalWriteable = telemetryFlat.filter((variable) => variable.writeable).length;

  return (
    <section className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Yachts", href: "/yachts" },
          { label: yacht.name, href: `/yachts/${encodeURIComponent(yacht.slug)}` },
          { label: "Devices", href: `/yachts/${encodeURIComponent(yacht.slug)}#devices` },
          { label: device.summary.deviceName }
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{device.summary.deviceName}</h1>
          {device.summary.productName && device.summary.productName !== device.summary.deviceName ? (
            <p className="mt-1 text-sm text-slate-500">{device.summary.productName}</p>
          ) : null}
          <p className="mt-1 text-sm text-slate-400">
            {yacht.name} · Bus {device.busId} · {totalTelemetry} telemetry variables · {totalWriteable} writeable
          </p>
        </div>
        <Link href={`/yachts/${encodeURIComponent(yacht.slug)}`} className="text-sm text-cyan-300 hover:text-cyan-200">
          Back to devices
        </Link>
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">Summary</h2>
        <p className="text-xs text-slate-500">Device metadata from the platform catalog — separate from live telemetry.</p>
        <DeviceSummaryPanel summary={device.summary} />
      </div>

      <form className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <label className="mb-2 block text-xs uppercase tracking-wide text-slate-400" htmlFor="q">
          Filter telemetry
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Search label, group, or index..."
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-700 placeholder:text-slate-500 focus:ring-2"
        />
      </form>

      <div className="space-y-4">
        {TELEMETRY_SECTIONS.map((section) => (
          <SectionAccordion
            key={section.key}
            title={section.title}
            sectionKey={section.key}
            variables={filteredTelemetry[section.key]}
          />
        ))}
      </div>
    </section>
  );
}
