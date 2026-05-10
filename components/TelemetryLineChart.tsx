"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = {
  ts: string;
  value: number;
};

function formatTs(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function TelemetryLineChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
        No telemetry samples in selected range.
      </div>
    );
  }

  return (
    <div className="h-[360px] w-full rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 14, left: 4, bottom: 12 }}>
          <XAxis
            dataKey="ts"
            tickFormatter={(value) => formatTs(String(value))}
            minTickGap={42}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
          />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} width={56} />
          <Tooltip
            labelFormatter={(value) => formatTs(String(value))}
            formatter={(value) => [String(value), "Value"]}
            contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "8px" }}
          />
          <Line type="monotone" dataKey="value" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
