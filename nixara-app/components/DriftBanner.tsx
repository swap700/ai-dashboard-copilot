"use client";

import Link from "next/link";
import type { DriftFlag } from "@/lib/drift";

export default function DriftBanner({ flags }: { flags: DriftFlag[] }) {
  if (flags.length === 0) return null;

  return (
    <div className="bg-warn-bg border border-warn-border rounded-xl p-4 mb-6 space-y-3">
      <p className="font-semibold text-warn text-sm">⚠ Decision drift detected</p>
      {flags.map((f) => (
        <div key={f.reportType} className="text-text text-xs leading-relaxed">
          <p>
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
          {/* Navigable, not just descriptive — links straight to the decision that
             drifted in Decision Memory, instead of leaving it to be found by hand. */}
          {f.decisionPublicId && (
            <Link
              href={`/memory?highlight=${encodeURIComponent(f.decisionPublicId)}`}
              className="inline-block mt-1 text-warn font-semibold hover:underline"
            >
              Review this decision in Memory →
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
