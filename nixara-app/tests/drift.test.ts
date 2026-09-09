/**
 * Regression tests for Decision Drift (lib/drift.ts).
 *
 * Run with:  npm run test:drift
 *
 * Covers the bug report (2026-09): a decision scored on a metric that never
 * persisted a baseline value, or a baseline scoped to a specific dimension
 * slice (e.g. "Furniture Category Profit Margin"), silently never triggered
 * drift no matter how much the real number had moved. See lib/drift.ts and
 * components/OutcomeForm.tsx for the fix.
 */

import { detectDrift } from "../lib/drift.ts";
import type { Dataset, Row } from "../lib/data-analysis.ts";
import type { RecordedDecision, RecordedOutcome } from "../lib/session-context.ts";
import type { ReportType } from "../lib/report.ts";

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL  ${name}${detail ? "  ->  " + detail : ""}`);
  }
}

// ── Fixture data ─────────────────────────────────────────────────────────────
//
// Mirrors the real bug report's shape: a retail dataset with a Category
// dimension and a Profit Margin metric that is a MEAN-type column (a ratio,
// not an amount), so the "current value" is an average, not a sum.

function makeDataset(rows: Row[]): Dataset {
  return { rows, columns: ["Category", "Profit Margin", "Sales"] };
}

// Furniture rows average to 0.0596 Profit Margin (the exact post-drift value
// from the bug report: 0.08 * 0.75 = 0.06, adjusted slightly so the mean
// over multiple rows lands on 0.0596). Office Supplies rows average to 0.15
// (unmoved) so a whole-dataset aggregate would look completely different
// from the Furniture-only slice.
const DRIFTED_DATASET = makeDataset([
  { Category: "Furniture", "Profit Margin": 0.062, Sales: 1000 },
  { Category: "Furniture", "Profit Margin": 0.058, Sales: 1200 },
  { Category: "Furniture", "Profit Margin": 0.059, Sales: 900 },
  { Category: "Furniture", "Profit Margin": 0.0594, Sales: 1100 },
  { Category: "Office Supplies", "Profit Margin": 0.15, Sales: 2000 },
  { Category: "Office Supplies", "Profit Margin": 0.15, Sales: 2100 },
]);
// Furniture mean = (0.062+0.058+0.059+0.0594)/4 = 0.0596 (matches spec exactly)

const SMALL_DECLINE_DATASET = makeDataset([
  { Category: "Furniture", "Profit Margin": 0.072, Sales: 1000 },
  { Category: "Furniture", "Profit Margin": 0.072, Sales: 1200 },
  { Category: "Office Supplies", "Profit Margin": 0.15, Sales: 2000 },
]);

const NO_FURNITURE_DATASET = makeDataset([
  { Category: "Technology", "Profit Margin": 0.20, Sales: 5000 },
  { Category: "Office Supplies", "Profit Margin": 0.15, Sales: 2000 },
]);

function baseDecision(overrides: Partial<RecordedDecision> = {}): RecordedDecision {
  return {
    choice: "approved",
    decisionId: 1,
    publicId: "abc123",
    role: "COO",
    datasetName: "superstore_data.csv",
    question: "Should we adjust pricing to protect margin?",
    timeframe: "This quarter",
    ...overrides,
  };
}

function baseOutcome(overrides: Partial<RecordedOutcome> = {}): RecordedOutcome {
  return {
    metricName: "Profit Margin",
    metricBefore: null,
    metricAfter: 0.08,
    metricUnit: "%",
    outcomeRating: "met",
    ...overrides,
  };
}

const RISK: ReportType = "Risk Report";

// ── (a) baseline 0.08 -> new value 0.0596 -> Drift triggers (25.5% decline) ──
{
  const decisions = { [RISK]: baseDecision() };
  const outcomes = {
    [RISK]: baseOutcome({ metricAfter: 0.08, metricDimension: "Category", metricDimensionValue: "Furniture" }),
  };
  const flags = detectDrift(DRIFTED_DATASET, decisions, outcomes);
  check("(a) drift triggers on 0.08 -> 0.0596 Furniture slice", flags.length === 1, JSON.stringify(flags));
  if (flags.length === 1) {
    check("(a) pctChange is RELATIVE (~-25.5%), not a raw point difference",
      Math.abs(flags[0].pctChange - -25.5) < 0.5, `got ${flags[0].pctChange}`);
    check("(a) currentValue reflects the Furniture-only slice, not the whole dataset",
      Math.abs(flags[0].currentValue - 0.0596) < 0.001, `got ${flags[0].currentValue}`);
    check("(a) flag carries the dimension context", flags[0].dimension === "Category" && flags[0].dimensionValue === "Furniture");
  }
}

// ── (b) baseline 0.08 -> new value 0.072 -> no Drift (10% decline, <=15%) ───
{
  const decisions = { [RISK]: baseDecision() };
  const outcomes = {
    [RISK]: baseOutcome({ metricAfter: 0.08, metricDimension: "Category", metricDimensionValue: "Furniture" }),
  };
  const flags = detectDrift(SMALL_DECLINE_DATASET, decisions, outcomes);
  check("(b) no drift on 0.08 -> 0.072 (10% <= 15% threshold)", flags.length === 0, JSON.stringify(flags));
}

// ── (c) no baseline metric available -> fail gracefully with explanation ───
{
  // c1: outcome exists but was never scored with a usable value (metricAfter null)
  const decisions1 = { [RISK]: baseDecision() };
  const outcomes1 = { [RISK]: baseOutcome({ metricAfter: null }) };
  let threw = false;
  let flags1: ReturnType<typeof detectDrift> = [];
  try {
    flags1 = detectDrift(DRIFTED_DATASET, decisions1, outcomes1);
  } catch {
    threw = true;
  }
  check("(c1) missing metricAfter does not throw", !threw);
  check("(c1) missing metricAfter produces no flag", flags1.length === 0);

  // c2: outcome has a baseline, but the persisted dimension column no longer
  // exists in the newly uploaded dataset (e.g. renamed/removed column) --
  // must skip gracefully, not crash or fall back to a wrong whole-dataset number.
  const outcomes2 = {
    [RISK]: baseOutcome({ metricDimension: "Region", metricDimensionValue: "Furniture" }),
  };
  let threw2 = false;
  let flags2: ReturnType<typeof detectDrift> = [];
  try {
    flags2 = detectDrift(DRIFTED_DATASET, { [RISK]: baseDecision() }, outcomes2);
  } catch {
    threw2 = true;
  }
  check("(c2) dimension column missing from new dataset does not throw", !threw2);
  check("(c2) dimension column missing from new dataset produces no flag", flags2.length === 0);

  // c3: a decision with no usable baseline sits alongside one that DOES have
  // one -- the missing baseline must not block evaluation of the other.
  const EXEC: ReportType = "Executive Summary";
  const decisions3 = { [RISK]: baseDecision(), [EXEC]: baseDecision({ decisionId: 2, publicId: "def456" }) };
  const outcomes3 = {
    [RISK]: baseOutcome({ metricAfter: null }),
    [EXEC]: baseOutcome({ metricAfter: 0.08, metricDimension: "Category", metricDimensionValue: "Furniture" }),
  };
  const flags3 = detectDrift(DRIFTED_DATASET, decisions3, outcomes3);
  check("(c3) a missing baseline on one decision doesn't block evaluating another",
    flags3.length === 1 && flags3[0].reportType === EXEC, JSON.stringify(flags3));
}

// ── (d) approved-but-unscored decision -> Drift should not evaluate ─────────
{
  const decisions = { [RISK]: baseDecision() };
  const outcomes = {}; // never scored at all -- no outcome recorded for this reportType
  const flags = detectDrift(DRIFTED_DATASET, decisions, outcomes);
  check("(d) unscored decision produces no flag", flags.length === 0, JSON.stringify(flags));
}

// ── (e) rejected/postponed decision -> Drift should not evaluate ───────────
{
  for (const choice of ["rejected", "postponed"] as const) {
    const decisions = { [RISK]: baseDecision({ choice }) };
    const outcomes = {
      [RISK]: baseOutcome({ metricAfter: 0.08, metricDimension: "Category", metricDimensionValue: "Furniture" }),
    };
    const flags = detectDrift(DRIFTED_DATASET, decisions, outcomes);
    check(`(e) ${choice} decision produces no flag even with a scored outcome`, flags.length === 0, JSON.stringify(flags));
  }
}

// ── (f) same metric name but wrong category/dimension -> must not incorrectly trigger ──
{
  // The decision was scored on Office Supplies, which hasn't moved (0.15 in
  // both datasets) -- a column-name-only match (the pre-fix behavior) would
  // ignore the slice entirely and compare against a WHOLE-DATASET Profit
  // Margin average, which differs from both 0.15 and the Furniture number,
  // and could easily cross the threshold for the wrong reason.
  const decisions = { [RISK]: baseDecision() };
  const outcomes = {
    [RISK]: baseOutcome({ metricAfter: 0.15, metricDimension: "Category", metricDimensionValue: "Office Supplies" }),
  };
  const flags = detectDrift(DRIFTED_DATASET, decisions, outcomes);
  check("(f) unrelated slice with an unmoved value produces no flag", flags.length === 0, JSON.stringify(flags));

  // And the inverse: the dimension VALUE the decision cares about isn't
  // present at all in the new upload (e.g. that category was dropped) --
  // must skip gracefully rather than compare against nothing / all rows.
  const outcomesMissingSlice = {
    [RISK]: baseOutcome({ metricAfter: 0.08, metricDimension: "Category", metricDimensionValue: "Furniture" }),
  };
  const flagsMissingSlice = detectDrift(NO_FURNITURE_DATASET, decisions, outcomesMissingSlice);
  check("(f) dimension value absent from new dataset produces no flag", flagsMissingSlice.length === 0, JSON.stringify(flagsMissingSlice));
}

// ── Backward compatibility: outcomes logged before this fix (no dimension) ──
// still work exactly as before -- whole-dataset comparison, matched purely by
// metric name overlap.
{
  const wholeDatasetDrifted = makeDataset([
    { Category: "Furniture", "Profit Margin": 0.0596, Sales: 1000 },
  ]);
  const decisions = { [RISK]: baseDecision() };
  const outcomes = { [RISK]: baseOutcome({ metricAfter: 0.08 }) }; // no dimension fields at all
  const flags = detectDrift(wholeDatasetDrifted, decisions, outcomes);
  check("legacy (no-dimension) outcomes still compare whole-dataset and trigger correctly",
    flags.length === 1 && flags[0].dimension === undefined, JSON.stringify(flags));
}

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
