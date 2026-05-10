import Link from "next/link";

import { getDeviceTelemetrySections } from "@/lib/groupData";
import { DeviceData } from "@/lib/types";

const SECTION_COLORS: Record<string, string> = {
  summary: "bg-emerald-950 text-emerald-300 border-emerald-800",
  monitoring: "bg-blue-950 text-blue-300 border-blue-800",
  alarm: "bg-red-950 text-red-300 border-red-800",
  history: "bg-amber-950 text-amber-300 border-amber-800"
};

export default function DeviceCard({ yachtSlug, device }: { yachtSlug: string; device: DeviceData }) {
  const telemetrySections = getDeviceTelemetrySections(device).filter((section) => section.count > 0);
  const telemetryTotal = telemetrySections.reduce((sum, section) => sum + section.count, 0);

  return (
    <Link
      href={`/yachts/${encodeURIComponent(yachtSlug)}/devices/${encodeURIComponent(String(device.busId))}`}
      className="group rounded-xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-slate-600 hover:bg-slate-800/80"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="line-clamp-2 flex-1 text-base font-semibold text-slate-100 group-hover:text-cyan-200">{device.summary.deviceName}</h2>
        <span className="shrink-0 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-300">
          {telemetryTotal} telemetry
        </span>
      </div>
      <p className="mb-2 font-mono text-[11px] text-slate-500">Bus {device.busId}</p>
      {device.summary.productName && device.summary.productName !== device.summary.deviceName ? (
        <p className="mb-2 line-clamp-1 text-xs text-slate-500">{device.summary.productName}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <span className={`rounded-md border px-2 py-1 text-xs capitalize ${SECTION_COLORS.summary}`}>Summary</span>
        {telemetrySections.length === 0 ? (
          <span className="text-sm text-slate-400">No telemetry sections</span>
        ) : (
          telemetrySections.map((section) => (
            <span
              key={section.name}
              className={`rounded-md border px-2 py-1 text-xs capitalize ${SECTION_COLORS[section.name] ?? "border-slate-700 bg-slate-800 text-slate-300"}`}
            >
              {section.name} ({section.count})
            </span>
          ))
        )}
      </div>
    </Link>
  );
}
