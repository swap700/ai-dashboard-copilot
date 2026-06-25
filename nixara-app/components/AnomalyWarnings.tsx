"use client";

import type { Dataset } from "@/lib/data-analysis";
import { detectAnomalies, numericColumns } from "@/lib/data-analysis";

export default function AnomalyWarnings({ dataset }: { dataset: Dataset }) {
  const warnings = numericColumns(dataset)
    .map((col) => ({ col, count: detectAnomalies(dataset, col).length }))
    .filter((w) => w.count > 0);

  if (warnings.length === 0) return null;

  return (
    <div className="mb-8 space-y-2">
      {warnings.map((w) => (
        <div
          key={w.col}
          className="bg-warn-bg border border-warn-border text-[#92400E] rounded-lg px-4 py-2.5 text-sm"
        >
          ⚠️ {w.count} anomalous row{w.count !== 1 ? "s" : ""} detected in <strong>{w.col}</strong> — flagged for the Risk Report
        </div>
      ))}
    </div>
  );
}
