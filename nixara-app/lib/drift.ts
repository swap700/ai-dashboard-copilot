/**
 * Decision Drift — scoped down from "Nixara notices conditions changed and
 * proactively reopens a decision" (which would need background monitoring;
 * this architecture has no cron/polling, only request-time serverless
 * functions) to: the next time a dataset is uploaded, check whether it
 * touches a metric a past decision was scored on, and flag it if that metric
 * has moved a lot since the outcome was logged. No new infrastructure — this
 * runs entirely at upload time, using data the session already has.
 */

import { businessMetricColumns, categoricalColumns, numericStats, smartAgg, tokenize, type Dataset } from "./data-analysis";
import type { RecordedDecision, RecordedOutcome } from "./session-context";
import type { ReportType } from "./report";

export interface DriftFlag {
  reportType: ReportType;
  metricName: string;
  matchedColumn: string;
  priorValue: number;
  currentValue: number;
  pctChange: number;
  decisionQuestion: string;
  /**
   * The drifted decision's public_id token (see decisions.ts) -- lets the
   * banner link straight to that decision in Decision Memory instead of just
   * naming it in prose. Null only if the decision somehow has no token,
   * which shouldn't happen in practice (every logged decision gets one).
   */
  decisionPublicId: string | null;
  /**
   * Present when the outcome this flag is based on was scored against a
   * specific slice of the dataset (e.g. dimension="Category",
   * dimensionValue="Furniture") rather than a whole-dataset aggregate --
   * see the matching fields on RecordedOutcome. Lets DriftBanner say exactly
   * which slice moved instead of implying the whole dataset did.
   */
  dimension?: string;
  dimensionValue?: string;
}

const DRIFT_THRESHOLD_PCT = 15;

/** True when two column/metric names share at least one normalized token. */
function namesOverlap(a: string, b: string): boolean {
  const ta = new Set(tokenize(a));
  return tokenize(b).some((t) => ta.has(t));
}

/**
 * Compares the new dataset's business metrics against every approved,
 * outcome-scored decision from the session that just ended (the caller
 * passes the OLD decisions/outcomes, captured before they're cleared for the
 * new dataset). Returns one flag per metric that both matches a column in
 * the new data and has moved more than DRIFT_THRESHOLD_PCT since it was
 * logged.
 */
export function detectDrift(
  dataset: Dataset,
  decisions: Partial<Record<ReportType, RecordedDecision>>,
  outcomes: Partial<Record<ReportType, RecordedOutcome>>
): DriftFlag[] {
  const metricCols = businessMetricColumns(dataset);
  if (metricCols.length === 0) return [];

  // Only computed if at least one outcome actually carries a dimension slice
  // -- categoricalColumns() walks every column of every row, so this stays
  // free for the (still common) case of outcomes with no slice at all.
  let catCols: string[] | null = null;

  const flags: DriftFlag[] = [];

  for (const [reportType, outcome] of Object.entries(outcomes) as [ReportType, RecordedOutcome | undefined][]) {
    // (d) Approved-but-unscored, or scored with no usable baseline value --
    // nothing to compare against. Graceful no-op: this decision is simply
    // skipped, every other decision in the same call is still evaluated.
    if (!outcome || outcome.metricAfter === null) continue;
    const decision = decisions[reportType];
    // (e) Rejected/postponed decisions were never acted on -- there is no
    // real-world result to have drifted.
    if (!decision || decision.choice !== "approved") continue;

    const matchedColumn = metricCols.find((col) => namesOverlap(col, outcome.metricName));
    // (c) The metric this decision was scored on no longer has a matching
    // column in the new dataset -- fail gracefully (skip just this
    // decision) rather than guessing at a different column.
    if (!matchedColumn) continue;

    let rows = dataset.rows;

    // Structured slice, when the outcome was scored against one (see
    // OutcomeForm.tsx / lib/decisions.ts). This is the fix for the original
    // bug report: a decision scored on "Furniture Category Profit Margin"
    // must be compared against Furniture-only rows in the new upload, not a
    // whole-dataset average that answers a different question. Missing
    // dimension/dimensionValue (outcomes logged before this existed, or with
    // no dataset loaded) means "whole dataset" -- unchanged from before.
    if (outcome.metricDimension && outcome.metricDimensionValue) {
      catCols ??= categoricalColumns(dataset);
      const dimensionColumn = catCols.find((col) => namesOverlap(col, outcome.metricDimension!));
      // (c) The dimension column itself is gone from the new dataset
      // (renamed/removed) -- can't locate the slice, fail gracefully.
      if (!dimensionColumn) continue;
      rows = rows.filter((r) => String(r[dimensionColumn] ?? "") === outcome.metricDimensionValue);
      // (f) / (c) The slice this decision cares about doesn't exist in the
      // new data at all (e.g. that category was dropped, or a dataset for an
      // unrelated slice was uploaded) -- fail gracefully rather than falling
      // back to an unfiltered aggregate, which would silently answer a
      // different question than the one actually being asked.
      if (rows.length === 0) continue;
    }

    const values = rows
      .map((r) => r[matchedColumn])
      .filter((v): v is number => typeof v === "number");
    // (c) No numeric values in the (possibly filtered) slice -- nothing to
    // compute a current value from.
    if (values.length === 0) continue;

    const stats = numericStats(values);
    const agg = smartAgg(matchedColumn, values);
    const currentValue = agg === "sum" ? stats.total : stats.mean;

    // RELATIVE movement, divided by the baseline -- e.g. 0.08 -> 0.0596 is a
    // 25.5% relative decline, not a 0.0204 percentage-point difference.
    const priorValue = outcome.metricAfter;
    if (priorValue === 0) continue;
    const pctChange = ((currentValue - priorValue) / Math.abs(priorValue)) * 100;

    if (Math.abs(pctChange) >= DRIFT_THRESHOLD_PCT) {
      flags.push({
        reportType,
        metricName: outcome.metricName,
        matchedColumn,
        priorValue,
        currentValue,
        pctChange,
        decisionQuestion: decision.question,
        decisionPublicId: decision.publicId,
        dimension: outcome.metricDimension ?? undefined,
        dimensionValue: outcome.metricDimensionValue ?? undefined,
      });
    }
  }

  return flags;
}
