import Link from "next/link";

export default function Header({ subtitle }: { subtitle?: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/yachts" className="text-lg font-semibold tracking-tight text-slate-100">
            Mastervolt Fleet Explorer
          </Link>
          <span className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
            Multi-yacht · Phase 1
          </span>
        </div>
        {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
      </div>
    </header>
  );
}
