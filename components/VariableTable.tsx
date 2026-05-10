import { Variable } from "@/lib/types";

function formatValue(value: Variable["value"]): string {
  if (value === null) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

export default function VariableTable({ variables }: { variables: Variable[] }) {
  if (!variables.length) {
    return <p className="p-4 text-sm text-slate-400">No variables in this section.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-slate-900/95">
          <tr>
            {["Index", "Group", "Label", "Value", "Unit", "Access"].map((col) => (
              <th
                key={col}
                className="border-b border-slate-700 px-3 py-3 text-left font-medium uppercase tracking-wide text-slate-300"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variables.map((item, idx) => (
            <tr key={`${item.index}-${item.label}-${idx}`} className={idx % 2 === 0 ? "bg-slate-900/40" : "bg-slate-950/50"}>
              <td className="border-b border-slate-800 px-3 py-2 font-mono text-cyan-200">{item.index}</td>
              <td className="border-b border-slate-800 px-3 py-2 text-slate-300">{item.group || "-"}</td>
              <td className="border-b border-slate-800 px-3 py-2 text-slate-100">{item.label}</td>
              <td className="border-b border-slate-800 px-3 py-2 font-mono text-slate-100">{formatValue(item.value)}</td>
              <td className="border-b border-slate-800 px-3 py-2 font-mono text-slate-300">{item.unit || "-"}</td>
              <td className="border-b border-slate-800 px-3 py-2">
                <span
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    item.writeable
                      ? "border border-amber-700 bg-amber-950 text-amber-300"
                      : "border border-slate-700 bg-slate-900 text-slate-300"
                  }`}
                >
                  {item.writeable ? "Writeable" : "Read Only"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
