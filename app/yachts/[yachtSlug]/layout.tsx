import Link from "next/link";
import { notFound } from "next/navigation";

import { getYachtBySlug } from "@/lib/data";

export default async function YachtScopeLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ yachtSlug: string }>;
}) {
  const { yachtSlug } = await params;
  const yacht = await getYachtBySlug(decodeURIComponent(yachtSlug));
  if (!yacht) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-950/40 bg-cyan-950/15 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-500/90">Active yacht</p>
          <p className="text-lg font-semibold text-cyan-50">{yacht.name}</p>
          <p className="font-mono text-xs text-slate-500">{yacht.slug}</p>
        </div>
        <Link href="/yachts" className="text-sm text-cyan-400 hover:text-cyan-300">
          Switch yacht
        </Link>
      </div>
      {children}
    </div>
  );
}
