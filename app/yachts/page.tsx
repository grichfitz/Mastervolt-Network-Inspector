import Breadcrumbs from "@/components/Breadcrumbs";
import YachtCard from "@/components/YachtCard";
import { getYachtExplorerStats, getYachts } from "@/lib/data";

export default async function YachtListPage() {
  const yachts = await getYachts();
  const enriched = await Promise.all(
    yachts.map(async (yacht) => ({
      yacht,
      ...(await getYachtExplorerStats(yacht))
    }))
  );

  return (
    <section className="space-y-6">
      <Breadcrumbs items={[{ label: "Yachts" }]} />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-slate-100 sm:text-3xl">Fleet</h1>
        <p className="max-w-3xl text-sm text-slate-400 sm:text-base">
          Platform-level yachts own all devices and telemetry. Use this view to manage yacht-scoped metadata and prepare telemetry operations.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {enriched.map(({ yacht, deviceCount, telemetryVariableCount }) => (
          <YachtCard
            key={yacht.id}
            yacht={yacht}
            deviceCount={deviceCount}
            telemetryVariableCount={telemetryVariableCount}
          />
        ))}
      </div>
    </section>
  );
}
