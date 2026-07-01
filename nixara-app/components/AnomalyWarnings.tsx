"use client";

import type { Dataset } from "@/lib/data-analysis";
import { detectAnomalies, businessMetricColumns } from "@/lib/data-analysis";

export default function AnomalyWarnings({ dataset }: { dataset: Dataset }) {
  const findings = businessMetricColumns(dataset)
    .map((col) => ({ col, count: detectAnomalies(dataset, col).length }))
    .filter((w) => w.count > 0);

  if (findings.length === 0) return null;

  return (
    <div className="mb-8 space-y-2">
      {findings.map((w) => (
        <div
          key={w.col}
          className="bg-accent-bg-soft border border-accent-border text-text rounded-lg px-4 py-2.5 text-sm flex items-start gap-2.5"
        >
          <span className="text-base leading-none mt-0.5 shrink-0">📊</span>
          <span>
            <strong>{w.col}</strong> shows {w.count} unusual {w.count !== 1 ? "entries" : "entry"}{" "}
            — likely outliers worth reviewing in your Risk Report
          </span>
        </div>
      ))}
    </div>
  );
}
