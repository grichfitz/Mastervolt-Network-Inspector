import { DeviceSummary } from "@/lib/types";

const FIELDS: Array<{ key: keyof DeviceSummary; label: string }> = [
  { key: "deviceName", label: "Device name" },
  { key: "productId", label: "Product ID" },
  { key: "serialNumber", label: "Serial number" },
  { key: "firmwareVersion", label: "Firmware version" },
  { key: "softwareVersion", label: "Software version" }
];

function formatValue(value: string | undefined): string {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "—";
  }
  return String(value);
}

export default function DeviceSummaryPanel({ summary }: { summary: DeviceSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {FIELDS.map(({ key, label }) => (
        <div
          key={key}
          className="rounded-lg border border-emerald-900/60 bg-emerald-950/25 px-4 py-3 shadow-sm shadow-emerald-950/20"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400/90">{label}</p>
          <p className="mt-1 font-mono text-sm text-emerald-50">{formatValue(summary[key] as string | undefined)}</p>
        </div>
      ))}
    </div>
  );
}
