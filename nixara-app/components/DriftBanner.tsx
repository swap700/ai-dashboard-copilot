"use client";

import type { DriftFlag } from "@/lib/drift";

export default function DriftBanner({ flags }: { flags: DriftFlag[] }) {
  if (flags.length === 0) return null;

  return (
    <div className="bg-warn-bg border border-warn-border rounded-xl p-4 mb-6 space-y-2">
      <p className="font-semibold text-warn text-sm">⚠ Decision drift detected</p>
      {flags.map((f) => (
        <p key={f.reportType} className="text-text text-xs leading-relaxed">
          <strong>{f.matchedColumn}</strong> was logged at{" "}
          <strong>{f.priorValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> for your{" "}
          {f.reportType} decision (&quot;{f.decisionQuestion}&quot;). This new data shows{" "}
          <strong>{f.currentValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> — a{" "}
          <strong>
            {f.pctChange > 0 ? "+" : ""}
            {f.pctChange.toFixed(1)}%
          </strong>{" "}
          change. Worth revisiting that decision before generating new reports.
        </p>
      ))}
    </div>
  );
}
