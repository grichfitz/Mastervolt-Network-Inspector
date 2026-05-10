import Link from "next/link";

import type { Yacht } from "@/lib/types";

export default function YachtCard({
  yacht,
  deviceCount,
  telemetryVariableCount
}: {
  yacht: Yacht;
  deviceCount: number;
  telemetryVariableCount: number;
}) {
  return (
    <Link
      href={`/yachts/${encodeURIComponent(yacht.slug)}`}
      className="group flex flex-col rounded-xl border border-slate-800 bg-slate-900/70 p-5 transition hover:border-slate-600 hover:bg-slate-800/80"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 group-hover:text-cyan-200">{yacht.name}</h2>
          <p className="mt-1 font-mono text-xs text-slate-500">/{yacht.slug}</p>
        </div>
        <span className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">
          Yacht
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Devices</dt>
          <dd className="font-mono text-lg text-slate-100">{deviceCount}</dd>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Telemetry rows</dt>
          <dd className="font-mono text-lg text-slate-100">{telemetryVariableCount}</dd>
        </div>
      </dl>
    </Link>
  );
}
