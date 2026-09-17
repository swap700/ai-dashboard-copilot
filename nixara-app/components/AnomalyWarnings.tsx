"use client";

import { useMemo } from "react";
import type { Dataset } from "@/lib/data-analysis";
import { detectAnomalies, businessMetricColumns, detectMissingValuesByColumn, detectMalformedEntries } from "@/lib/data-analysis";

interface Props {
  dataset: Dataset;
  /** Whether a Risk Report already exists to jump into. */
  hasRiskReport: boolean;
  /** Switches ReportTabs to Risk Report and scrolls to Data Quality Risks. */
  onJumpToDataQuality: () => void;
  /** Used instead, when there's no Risk Report yet to jump to - scrolls to the Generate button so the user can produce one first. */
  onJumpToGenerate: () => void;
}

/**
 * BUG FIX (2026-09): this used to render one card per column with any
 * z-score outliers, phrased as "N unusual entries - likely outliers worth
 * reviewing in your Risk Report" - implying every one of them was a problem.
 * Most aren't: a negative Profit Margin or an unusually large Quantity is a
 * real business fact that happens to be numerically unusual, not a broken
 * cell (the Risk Report prompt already says this explicitly elsewhere -
 * "detected outliers reflect business patterns, treat as signals, not data
 * errors" - this component just never matched that framing).
 *
 * Now split into two, deliberately different, tones:
 *   - Statistical patterns: neutral, no implication of a problem, points at
 *     Top Risks Identified where the model decides if one is worth flagging.
 *   - Real data issues (missing values, malformed entries): the only thing
 *     phrased as something to go fix, because it's the only thing that
 *     actually is one.
 */
export default function AnomalyWarnings({ dataset, hasRiskReport, onJumpToDataQuality, onJumpToGenerate }: Props) {
  // Same O(rows x columns) class of cost Charts.tsx already had to debounce
  // decisionText against (see lib/use-debounced-value.ts) - this now runs
  // three detection passes instead of one, so recomputing on every parent
  // re-render (e.g. every keystroke elsewhere on the page) is worth avoiding
  // rather than carrying forward unmemoized.
  const { statisticalCount, realIssueCount } = useMemo(() => {
    const statistical = businessMetricColumns(dataset).filter((col) => detectAnomalies(dataset, col).length > 0);
    const missing = detectMissingValuesByColumn(dataset);
    const malformed = detectMalformedEntries(dataset);
    return { statisticalCount: statistical.length, realIssueCount: missing.length + malformed.length };
  }, [dataset]);

  if (statisticalCount === 0 && realIssueCount === 0) return null;

  const handleDataQualityClick = () => {
    if (hasRiskReport) onJumpToDataQuality();
    else onJumpToGenerate();
  };

  return (
    <div className="mb-8 space-y-2">
      {statisticalCount > 0 && (
        <div className="bg-accent-bg-soft border border-accent-border text-text rounded-lg px-4 py-2.5 text-sm flex items-start gap-2.5">
          <span className="text-base leading-none mt-0.5 shrink-0">📊</span>
          <span>
            {statisticalCount} column{statisticalCount === 1 ? "" : "s"} show{statisticalCount === 1 ? "s" : ""}{" "}
            statistically unusual values — worth a look if any turn out to be a real business risk, not necessarily
            a problem with your data.
          </span>
        </div>
      )}

      {realIssueCount > 0 && (
        <button
          type="button"
          onClick={handleDataQualityClick}
          className="w-full text-left bg-warn-bg border border-warn-border text-text rounded-lg px-4 py-2.5 text-sm flex items-start gap-2.5 hover:border-warn transition-colors"
        >
          <span className="text-base leading-none mt-0.5 shrink-0">⚠️</span>
          <span>
            <strong>
              {realIssueCount} real data issue{realIssueCount === 1 ? "" : "s"} found
            </strong>
            {" — "}
            <span className="underline font-semibold text-accent-dk">
              {hasRiskReport ? "see the full breakdown in your Risk Report" : "generate your reports to see the full breakdown"}
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
