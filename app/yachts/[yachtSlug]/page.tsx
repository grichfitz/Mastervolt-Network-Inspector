import { notFound } from "next/navigation";
import Link from "next/link";

import Breadcrumbs from "@/components/Breadcrumbs";
import DeviceCard from "@/components/DeviceCard";
import { getDevicesForYacht, getYachtBySlug, getYachtExplorerStats } from "@/lib/data";

export default async function YachtOverviewPage({ params }: { params: Promise<{ yachtSlug: string }> }) {
  const { yachtSlug } = await params;
  const slug = decodeURIComponent(yachtSlug);
  const yacht = await getYachtBySlug(slug);
  if (!yacht) {
    notFound();
  }

  const devices = await getDevicesForYacht(yacht);
  const stats = await getYachtExplorerStats(yacht);

  return (
    <section className="space-y-8">
      <Breadcrumbs
        items={[
          { label: "Yachts", href: "/yachts" },
          { label: yacht.name }
        ]}
      />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 sm:text-3xl">{yacht.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Overview and onboard devices. Routes use stable bus IDs; labels are display-only.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Link
            href={`/yachts/${encodeURIComponent(yacht.slug)}/telemetry`}
            className="rounded-lg border border-cyan-700 bg-cyan-900/35 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-900/60"
          >
            Open telemetry graph
          </Link>
          <dl className="flex gap-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-center">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Devices</dt>
              <dd className="font-mono text-xl text-slate-100">{stats.deviceCount}</dd>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-center">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Telemetry rows</dt>
              <dd className="font-mono text-xl text-slate-100">{stats.telemetryVariableCount}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div id="devices" className="space-y-4 scroll-mt-24">
        <h2 className="text-lg font-semibold text-slate-200">Devices</h2>

        {devices.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-400">
            No devices available for this yacht in the current data source.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {devices.map((device) => (
              <DeviceCard key={device.busId} yachtSlug={yacht.slug} device={device} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
