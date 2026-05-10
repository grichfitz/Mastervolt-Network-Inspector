import Link from "next/link";

export default function NotFound() {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center">
      <h1 className="text-2xl font-semibold text-slate-100">Device not found</h1>
      <p className="mt-2 text-slate-400">The requested device ID is invalid or unavailable in this snapshot.</p>
      <Link href="/" className="mt-4 inline-block text-cyan-300 hover:text-cyan-200">
        Return to explorer
      </Link>
    </section>
  );
}
