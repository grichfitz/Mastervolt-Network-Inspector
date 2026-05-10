"use client";

import { useMemo, useState } from "react";

import VariableTable from "@/components/VariableTable";
import { Variable } from "@/lib/types";

const SECTION_COLORS: Record<string, string> = {
  monitoring: "text-blue-300 border-blue-800 bg-blue-950",
  alarm: "text-red-300 border-red-800 bg-red-950",
  history: "text-amber-300 border-amber-800 bg-amber-950"
};

type Props = {
  title: string;
  sectionKey: "monitoring" | "alarm" | "history";
  variables: Variable[];
};

export default function SectionAccordion({ title, sectionKey, variables }: Props) {
  const [open, setOpen] = useState(variables.length > 0);

  const badgeClasses = useMemo(
    () => SECTION_COLORS[sectionKey] ?? "text-slate-300 border-slate-700 bg-slate-900",
    [sectionKey]
  );

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 text-left transition hover:bg-slate-900/40"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-100">{title}</h3>
          <span className={`rounded-md border px-2 py-1 text-xs font-medium capitalize ${badgeClasses}`}>
            {variables.length} variables
          </span>
        </div>
        <span className="font-mono text-slate-400">{open ? "-" : "+"}</span>
      </button>
      <div className={`transition-all duration-300 ease-out ${open ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}`}>
        <VariableTable variables={variables} />
      </div>
    </section>
  );
}
