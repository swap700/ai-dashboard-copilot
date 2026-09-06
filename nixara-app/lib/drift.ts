/**
 * Decision Drift — scoped down from "Nixara notices conditions changed and
 * proactively reopens a decision" (which would need background monitoring;
 * this architecture has no cron/polling, only request-time serverless
 * functions) to: the next time a dataset is uploaded, check whether it
 * touches a metric a past decision was scored on, and flag it if that metric
 * has moved a lot since the outcome was logged. No new infrastructure — this
 * runs entirely at upload time, using data the session already has.
 */

import { businessMetricColumns, numericStats, smartAgg, tokenize, type Dataset } from "./data-analysis";
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

  const flags: DriftFlag[] = [];

  for (const [reportType, outcome] of Object.entries(outcomes) as [ReportType, RecordedOutcome | undefined][]) {
    if (!outcome || outcome.metricAfter === null) continue;
    const decision = decisions[reportType];
    if (!decision || decision.choice !== "approved") continue;

    const matchedColumn = metricCols.find((col) => namesOverlap(col, outcome.metricName));
    if (!matchedColumn) continue;

    const values = dataset.rows
      .map((r) => r[matchedColumn])
      .filter((v): v is number => typeof v === "number");
    if (values.length === 0) continue;

    const stats = numericStats(values);
    const agg = smartAgg(matchedColumn, values);
    const currentValue = agg === "sum" ? stats.total : stats.mean;

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
      });
    }
  }

  return flags;
}
