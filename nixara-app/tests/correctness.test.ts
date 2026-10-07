/**
 * Regression tests for the data-correctness fixes.
 *
 * Run with:  npm run test:correctness
 *
 * Each case maps to a specific bug. A failure here means a number in a
 * generated report is wrong, which is the failure mode that costs credibility
 * with a finance-trained reader.
 */

import { smartAgg, numericStats, aggregateBy, pairwiseCorrelation, humanizeColumnName, schemaOverlapRatio, SCHEMA_OVERLAP_THRESHOLD, looksLikeBoundedCount, buildDataSummary, detectMissingValuesByColumn, dashboardScoreBreakdown, describeAnomalies, detectAnomalies, computeDerivedFigures, numericColumns, numericDensity, businessMetricColumns, isNonQuantityColumn, pickChartSpecs, aggWord, type Dataset, type Row } from "../lib/data-analysis.ts";
import { buildEvidenceFacts, findUnverifiedLines, findUnverifiedFigures } from "../lib/evidence.ts";
import { suggestOutcomeRating } from "../lib/outcome-rating.ts";

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

function agg(col: string, expected: "mean" | "sum", values?: number[]): void {
  const actual = smartAgg(col, values);
  check(`smartAgg("${col}") = ${expected}`, actual === expected, `got ${actual}`);
}

// ── smartAgg: the substring false positives ─────────────────────────────────
console.log("smartAgg - substring false positives (the Discount bug)");

// "Discount" contains "count", a SUM keyword. This is the bug that shipped.
agg("Discount", "mean");
agg("discount", "mean");
agg("Discount %", "mean");
agg("Headcount", "sum");        // explicit token, genuinely additive
agg("Account Balance", "mean"); // "account" must not match "count"
agg("Percentage", "mean");      // contains "age", which is a MEAN keyword anyway
agg("Discount Rate", "mean");   // "rate" wins
agg("Discount Amount", "sum");  // "amount" wins - why "discount" is in neither list

// ── smartAgg: the cases that must not regress ───────────────────────────────
console.log("smartAgg - additive and per-entity columns still classify correctly");

for (const col of ["Sales", "Profit", "Revenue", "Quantity", "Total Cost", "Order Amount",
                   "Units Sold", "Expenses", "Distinct count of Order ID"]) {
  agg(col, "sum");
}
for (const col of ["Age", "Average Order Value", "Profit Margin", "Win Rate", "Rating",
                   "BMI", "Tenure", "Satisfaction Score", "Length of Stay"]) {
  agg(col, "mean");
}

// camelCase and snake_case must tokenise the same way
agg("discountRate", "mean");
agg("total_sales", "sum");
agg("unitPrice", "sum");

// ── smartAgg: value-shape backstop ──────────────────────────────────────────
console.log("smartAgg - value shape overrides an amount-like name");

const proportions = [0.1, 0.2, 0.15, 0.8, 0.45, 0.3, 0.22, 0.6, 0.05, 0.5];
const wholeAmounts = [120, 4300, 55, 900, 12000, 340, 78, 2200, 65, 1400];

// Named like an amount, shaped like a rate -> averaged.
agg("Discount Amount", "mean", proportions);
// Named like an amount and shaped like one -> still summed.
agg("Discount Amount", "sum", wholeAmounts);
// Too small a sample to judge - name wins, no behaviour change.
agg("Discount Amount", "sum", [0.1, 0.2, 0.3]);
// Integers in [0,1] are flags, not proportions - must not hijack a sum.
agg("Order Count", "sum", [0, 1, 1, 0, 1, 1, 0, 1, 0, 1]);
// Negatives are never proportions.
agg("Total Amount", "sum", [-0.5, 0.2, 0.9, 0.1, 0.4, 0.7, 0.3, 0.6, 0.2, 0.8]);
// No values passed at all -> identical to the name-only decision.
check(
  "omitting values leaves the decision unchanged",
  smartAgg("Discount Amount") === smartAgg("Discount Amount", undefined)
);

// ── numericStats: the Math.min spread crash ─────────────────────────────────
console.log("numericStats - correctness and the large-array crash");

const st = numericStats([3, -1, 4, 1, 5, 9, 2, 6]);
check("count", st.count === 8, String(st.count));
check("min", st.min === -1, String(st.min));
check("max", st.max === 9, String(st.max));
check("total", st.total === 29, String(st.total));
check("mean", Math.abs(st.mean - 29 / 8) < 1e-9, String(st.mean));
check("std is positive", st.std > 0);

const empty = numericStats([]);
check("empty array does not produce NaN or Infinity",
  empty.count === 0 && empty.min === 0 && empty.max === 0 &&
  Number.isFinite(empty.mean) && Number.isFinite(empty.std));

check("single value", (() => {
  const one = numericStats([42]);
  return one.min === 42 && one.max === 42 && one.mean === 42 && one.std === 0;
})());

// The actual regression: Math.min(...values) threw RangeError above ~125k.
// A 20 MB upload (the app's limit) is comfortably past that.
const huge = Array.from({ length: 300_000 }, (_, i) => (i % 1000) - 500);
let crashed = false;
let hugeStats = numericStats([0]);
try {
  hugeStats = numericStats(huge);
} catch {
  crashed = true;
}
check("300k values do not throw RangeError", !crashed);
check("300k values give correct min/max",
  hugeStats.min === -500 && hugeStats.max === 499,
  `min=${hugeStats.min} max=${hugeStats.max}`);

// Prove the old approach really does fail, so this test is guarding something.
let spreadCrashed = false;
try {
  Math.min(...huge);
} catch {
  spreadCrashed = true;
}
check("the old Math.min(...spread) approach still crashes at this size", spreadCrashed);

// ── End to end: a Discount column through aggregateBy ───────────────────────
console.log("aggregateBy - end to end on a superstore-shaped dataset");

const rows = [
  { Region: "Central", Discount: 0.2, Sales: 100 },
  { Region: "Central", Discount: 0.4, Sales: 300 },
  { Region: "East",    Discount: 0.6, Sales: 200 },
  { Region: "East",    Discount: 0.8, Sales: 600 },
];
const dataset: Dataset = { rows, columns: ["Region", "Discount", "Sales"] };

const byDiscount = aggregateBy(dataset, "Region", "Discount").points;
const central = byDiscount.find((d) => d.key === "Central")!;
check("Discount is averaged, not summed", Math.abs(central.value - 0.3) < 1e-9,
  `Central Discount = ${central.value} (summed would be 0.6)`);

const bySales = aggregateBy(dataset, "Region", "Sales").points;
check("Sales is still summed",
  bySales.find((d) => d.key === "Central")!.value === 400,
  String(bySales.find((d) => d.key === "Central")!.value));

// ── pairwiseCorrelation: the column misalignment bug ────────────────────────
console.log("pairwiseCorrelation - misaligned columns");

/**
 * A dataset where the two columns have missing values in DIFFERENT rows.
 *   rows 0-4    A only          (5 rows)
 *   rows 5-16   both, B = 2*A   (12 rows -> true r is exactly +1)
 *   rows 17-21  B only          (5 rows)
 */
const corrRows: Row[] = [
  ...Array.from({ length: 5 }, (_, i) => ({ A: 100 + i, B: null })),
  ...Array.from({ length: 12 }, (_, i) => ({ A: i + 1, B: 2 * (i + 1) })),
  ...Array.from({ length: 5 }, () => ({ A: null, B: 999 })),
];

const corr = pairwiseCorrelation(corrRows, "A", "B");
check("finds the 12 rows where both columns are present", corr?.n === 12, `n=${corr?.n}`);
check("recovers the exact correlation (+1)", !!corr && Math.abs(corr.r - 1) < 1e-9,
  `r=${corr?.r}`);

// The old implementation, verbatim, on the same data - to show the bug was real.
function correlationOld(rows: Row[], a: string, b: string): number | null {
  const av = rows.map((r) => r[a]).filter((v): v is number => typeof v === "number");
  const bv = rows.map((r) => r[b]).filter((v): v is number => typeof v === "number");
  const n = Math.min(av.length, bv.length);
  if (n < 2) return null;
  const ma = av.slice(0, n).reduce((x, y) => x + y, 0) / n;
  const mb = bv.slice(0, n).reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let k = 0; k < n; k++) {
    num += (av[k] - ma) * (bv[k] - mb);
    da += (av[k] - ma) ** 2;
    db += (bv[k] - mb) ** 2;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? null : num / denom;
}

const oldR = correlationOld(corrRows, "A", "B");
check(
  "the old index-zip approach got this materially wrong",
  oldR !== null && Math.abs(oldR - 1) > 0.1,
  `old r=${oldR?.toFixed(3)} vs true 1.000`
);

// Symmetry, guards, and degenerate input
const ab = pairwiseCorrelation(corrRows, "A", "B");
const ba = pairwiseCorrelation(corrRows, "B", "A");
check("correlation is symmetric", Math.abs((ab?.r ?? 0) - (ba?.r ?? 0)) < 1e-12);

check("too little overlap returns null",
  pairwiseCorrelation(
    [...Array.from({ length: 5 }, (_, i) => ({ A: i, B: i })),
     ...Array.from({ length: 20 }, (_, i) => ({ A: i, B: null }))],
    "A", "B"
  ) === null);

check("a constant column returns null rather than NaN",
  pairwiseCorrelation(
    Array.from({ length: 20 }, (_, i) => ({ A: i, B: 7 })), "A", "B"
  ) === null);

check("non-finite values are excluded",
  (() => {
    const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({ A: i, B: 2 * i }));
    rows[0] = { A: Infinity, B: NaN };
    const r = pairwiseCorrelation(rows, "A", "B");
    return r !== null && r.n === 19 && Math.abs(r.r - 1) < 1e-9;
  })());

check("perfect negative correlation",
  (() => {
    const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({ A: i, B: -3 * i }));
    const r = pairwiseCorrelation(rows, "A", "B");
    return r !== null && Math.abs(r.r + 1) < 1e-9;
  })());

// ── humanizeColumnName: chart tooltip/legend labels ─────────────────────────
//
// BUG FIX (2026-09): Charts.tsx's Bar/Area series had no explicit Recharts
// `name`, so hovering a bar showed the literal dataKey -- "value : 12.95" --
// instead of the actual metric. Column names also went into chart titles
// verbatim (e.g. "years_experience by industry", rendered upper-cased by CSS
// as "YEARS_EXPERIENCE BY INDUSTRY"). humanizeColumnName() is what fixes both.
console.log("humanizeColumnName - display labels for chart titles/tooltips");

check('snake_case: "years_experience" -> "Years Experience"',
  humanizeColumnName("years_experience") === "Years Experience");
check('camelCase: "discountRate" -> "Discount Rate"',
  humanizeColumnName("discountRate") === "Discount Rate");
check('already-clean names pass through unchanged: "Profit Margin"',
  humanizeColumnName("Profit Margin") === "Profit Margin");
check('acronyms/proper nouns are not lowercased: "Customer ID"',
  humanizeColumnName("Customer ID") === "Customer ID");
check('internal casing after a non-letter separator is preserved: "State/Province"',
  humanizeColumnName("State/Province") === "State/Province");
check('kebab-case: "unit-price" -> "Unit Price"',
  humanizeColumnName("unit-price") === "Unit Price");

// ── schemaOverlapRatio: dataset-identity sanity check for the Inbox's
// filename-based dataset matching (see app/inbox/page.tsx's isSameDataset) ──
console.log("schemaOverlapRatio - dataset schema overlap sanity check");

check("identical column lists -> ratio 1",
  schemaOverlapRatio(["Category", "Sales", "Profit"], ["Category", "Sales", "Profit"]) === 1);
check("completely disjoint column lists -> ratio 0",
  schemaOverlapRatio(["Category", "Sales", "Profit"], ["Patient ID", "Readmission Rate"]) === 0);
check("partial overlap -> fraction of ORIGINAL columns still present",
  Math.abs(schemaOverlapRatio(["Category", "Sales", "Profit", "Discount"], ["Category", "Sales"]) - 0.5) < 1e-9);
check("case/whitespace differences still count as a match",
  schemaOverlapRatio(["Profit Margin"], [" profit margin "]) === 1);
check("extra columns in the NEW dataset don't count against the ratio",
  schemaOverlapRatio(["Category", "Sales"], ["Category", "Sales", "New Column", "Another One"]) === 1);
check("empty original column list -> ratio 0 (nothing to confirm), not NaN or a throw",
  schemaOverlapRatio([], ["Category", "Sales"]) === 0);
check("the 0.8 threshold rejects a barely-over-half-different reshape",
  schemaOverlapRatio(["A", "B", "C", "D", "E"], ["A", "B", "C"]) < SCHEMA_OVERLAP_THRESHOLD);
check("the 0.8 threshold accepts a dataset missing only one minor column",
  schemaOverlapRatio(["A", "B", "C", "D", "E"], ["A", "B", "C", "D"]) >= SCHEMA_OVERLAP_THRESHOLD);

// ── looksLikeBoundedCount: keeps z-score anomaly detection off count/scale
// columns that are numeric but not actually continuous business metrics
// (see the "Data Quality Risks" root-cause fix in buildDataSummary) ────────
console.log("looksLikeBoundedCount - discrete count/scale columns vs. continuous metrics");

function datasetOf(col: string, values: number[]): Dataset {
  return { rows: values.map((v) => ({ [col]: v })), columns: [col] };
}

check("a 0-5 count column (e.g. children, chronic conditions) is bounded-count",
  looksLikeBoundedCount(datasetOf("children", [0, 1, 1, 2, 0, 3, 5, 1, 0, 2]), "children"));
check("a continuous metric with many distinct values is NOT bounded-count",
  !looksLikeBoundedCount(datasetOf("bmi", [16.0, 18.2, 22.4, 25.7, 28.9, 31.1, 33.6, 40.2, 21.9, 27.3, 45.0]), "bmi"));
check("a wide-range integer metric (e.g. salary) is NOT bounded-count even though every value is an integer",
  !looksLikeBoundedCount(datasetOf("salary", [30221, 45892, 61034, 78221, 92455, 110983, 125467, 143290, 160002, 176977, 55000]), "salary"));
check("negative values disqualify bounded-count (a count/scale is never negative)",
  !looksLikeBoundedCount(datasetOf("delta", [-2, -1, 0, 1, 2]), "delta"));
check("fractional values disqualify bounded-count even with few distinct values",
  !looksLikeBoundedCount(datasetOf("rate", [0.1, 0.2, 0.1, 0.3, 0.2]), "rate"));
check("an empty column is not bounded-count (nothing to classify)",
  !looksLikeBoundedCount({ rows: [], columns: ["x"] }, "x"));

// ── buildDataSummary: primaryMetric/profitCols must never pick a ratio
// column, and an ID/distinct-count column must never be summed as if it
// were an additive business figure (the East-region Profit + "999 distinct
// customers as a dollar figure" bugs from a real superstore_data.csv report) ──
console.log("buildDataSummary - primaryMetric excludes ratio columns; ID/count columns are never summed");

function preAggregatedSuperstoreDataset(): Dataset {
  // Shaped like the real dataset that surfaced these bugs: one row per
  // (Region, Category) slice, where "Profit Margin" is a per-slice RATIO
  // and "Distinct count of Customer ID" is a per-slice COUNT -- neither is
  // valid to sum across slices, unlike "Profit" and "Sales".
  const rows: Row[] = [
    { Region: "East", Category: "Tech", "Profit Margin": 0.19, "Distinct count of Customer ID": 600, Profit: 48441.75, Sales: 255000 },
    { Region: "East", Category: "Office", "Profit Margin": 0.30, "Distinct count of Customer ID": 399, Profit: 42996.71, Sales: 190000 },
    { Region: "Central", Category: "Tech", "Profit Margin": 0.15, "Distinct count of Customer ID": 500, Profit: 33697.45, Sales: 200000 },
  ];
  return { rows, columns: ["Region", "Category", "Profit Margin", "Distinct count of Customer ID", "Profit", "Sales"] };
}

const summary = buildDataSummary(preAggregatedSuperstoreDataset());

check("BREAKDOWN BY REGION cites the real Profit sum for East ($94,883.24 shape), never a Profit-Margin-confused figure",
  summary.includes("Profit by Region: East=91438.46") || /Profit by Region:[^\n]*East=91438\.46/.test(summary),
  summary.split("\n").find(l => l.includes("Profit by Region")) ?? "(no such line)");

check("BREAKDOWN BY REGION never sums Profit Margin as if it were a dollar total",
  !/Profit Margin by Region:[^\n]*East=(?!0\.)/.test(summary) , "(a non-ratio-looking Profit Margin total leaked into the breakdown)");

check("Distinct count of Customer ID never appears in a BREAKDOWN section (it is not a valid thing to sum)",
  !/Distinct count of Customer ID by (Region|Category)/.test(summary),
  summary.split("\n").find(l => l.includes("Distinct count of Customer ID by")) ?? "(correctly absent)");

check("NUMERIC SUMMARY labels Distinct count of Customer ID as a per-row count, with no fabricated TOTAL",
  /Distinct count of Customer ID:[^\n]*\[identifier\/count column/.test(summary) &&
  !/Distinct count of Customer ID:[^\n]*TOTAL=/.test(summary),
  summary.split("\n").find(l => l.startsWith("  Distinct count of Customer ID:")) ?? "(line not found)");

check("NUMERIC SUMMARY still totals genuine dollar metrics normally (Profit keeps its TOTAL)",
  /Profit:[^\n]*TOTAL=125135\.91/.test(summary),
  summary.split("\n").find(l => l.startsWith("  Profit:")) ?? "(line not found)");

check("CROSS-BREAKDOWN / TOP-BOTTOM are computed on Profit (the real dollar metric), not Profit Margin",
  summary.includes("(Profit)") && !summary.includes("(Profit Margin)"),
  "(primaryMetric picked the ratio column instead of the dollar column)");

// ── detectMissingValuesByColumn / dashboardScoreBreakdown: a genuinely
// blank cell is still caught (the fix that removed the file-parser
// corruption must never make real missing-data detection go quiet), and a
// common null-placeholder TEXT token in a categorical column ("NULL",
// "N/A", "#N/A", ...) is now caught too, where it previously passed through
// undetected entirely ────────────────────────────────────────────────────
console.log("detectMissingValuesByColumn - real blanks and null-placeholder text tokens");

const genuinelyBlank: Dataset = {
  rows: [{ Profit: 100 }, { Profit: null }, { Profit: 200 }, { Profit: "" }],
  columns: ["Profit"],
};
check("a genuinely blank/null numeric cell is still flagged as missing (not silently dropped by the corruption fix)",
  detectMissingValuesByColumn(genuinelyBlank).find((i) => i.column === "Profit")?.count === 2,
  JSON.stringify(detectMissingValuesByColumn(genuinelyBlank)));

const placeholderText: Dataset = {
  rows: [
    { Notes: "ok" }, { Notes: "NULL" }, { Notes: "N/A" }, { Notes: "n/a" },
    { Notes: "#N/A" }, { Notes: "none" }, { Notes: "fine" }, { Notes: "Unknown" },
  ],
  columns: ["Notes"],
};
const notesIssue = detectMissingValuesByColumn(placeholderText).find((i) => i.column === "Notes");
check("common null-placeholder tokens (NULL, N/A, n/a, #N/A, none) are caught in a categorical column",
  notesIssue?.count === 5, JSON.stringify(notesIssue));
check("a legitimate category ('Unknown') is never miscounted as missing just because it sounds uncertain",
  detectMissingValuesByColumn(placeholderText).find((i) => i.column === "Notes")!.count < 6);

check("dashboardScoreBreakdown's missingRatio agrees with detectMissingValuesByColumn (same isMissingValue rule)",
  Math.abs(dashboardScoreBreakdown(placeholderText).missingRatio - 5 / 8) < 1e-9,
  JSON.stringify(dashboardScoreBreakdown(placeholderText)));

// ── describeAnomalies: names not just how many rows are statistically
// unusual in a column, but the actual most-extreme value among them --
// deterministically, so the anomaly banner can show it without needing a
// generated report ─────────────────────────────────────────────────────────
console.log("describeAnomalies - the actual extreme value behind a flagged column");

function columnOf(values: number[]): Dataset {
  return { rows: values.map((v) => ({ x: v })), columns: ["x"] };
}

check("no anomalies -> null, not an empty/zero placeholder",
  describeAnomalies(columnOf([10, 11, 9, 10, 12, 10, 11, 9, 10]), "x") === null);

const highOutlier = columnOf([10, 11, 9, 10, 12, 10, 11, 9, 10, 500]);
const highDesc = describeAnomalies(highOutlier, "x");
check("an outlier far ABOVE the mean is reported with direction 'high' and its real value",
  highDesc?.direction === "high" && highDesc.extremeValue === 500, JSON.stringify(highDesc));

const lowOutlier = columnOf([10, 11, 9, 10, 12, 10, 11, 9, 10, -500]);
const lowDesc = describeAnomalies(lowOutlier, "x");
check("an outlier far BELOW the mean is reported with direction 'low' and its real value",
  lowDesc?.direction === "low" && lowDesc.extremeValue === -500, JSON.stringify(lowDesc));

check("a column shaped like a bounded proportion is marked isProportion",
  describeAnomalies(columnOf([0.1, 0.12, 0.11, 0.5, 0.13, 0.1, 0.11, 0.9, 0.12]), "x")?.isProportion === true);
check("a column with negative or >1 values (e.g. a margin that can go negative) is NOT forced into isProportion",
  describeAnomalies(columnOf([0.1, -0.5, 0.11, 2.5, 0.13, 0.1, 0.11, 0.9, 0.12]), "x")?.isProportion === false);


// ── Outlier check skips columns where "unusual" is meaningless ──────────────
console.log("\nOutlier exclusion - coordinates, postal codes, calendar years");
{
  const oneCol = (name: string, values: number[]): Dataset => ({ columns: [name], rows: values.map((v) => ({ [name]: v })) });
  const around = (center: number, n = 40): number[] => Array.from({ length: n }, (_, i) => center + (i % 5));

  check("control: an ordinary metric with one extreme value IS flagged",
    detectAnomalies(oneCol("score", [...around(40), 400]), "score").length >= 1);
  check("latitude is not flagged, even with an extreme value",
    detectAnomalies(oneCol("latitude", [...around(38), -48.26]), "latitude").length === 0);
  check("Longitude (capitalised) is not flagged",
    detectAnomalies(oneCol("Longitude", [...around(-90), 150]), "Longitude").length === 0);
  check("Postal Code is not flagged",
    detectAnomalies(oneCol("Postal Code", [...around(42000), 99999]), "Postal Code").length === 0);
  check("a year-shaped column is not flagged (year_introduced with a 1884)",
    detectAnomalies(oneCol("year_introduced", [...around(2000, 60), 1884]), "year_introduced").length === 0);
  check("...nor one that does not say 'year' in its name (Opening Date holding years)",
    detectAnomalies(oneCol("Opening Date", [...around(2000, 60), 1895]), "Opening Date").length === 0);
  check("Years Experience is still checked: a measure, not a calendar year",
    detectAnomalies(oneCol("Years Experience", [...around(10), 55]), "Years Experience").length >= 1);
  check("a column that merely contains a year-sized number among decimals is still checked",
    detectAnomalies(oneCol("amount", [...around(1900, 40).map((v) => v + 0.5), 5000]), "amount").length >= 1);
}

// ── Derived figures: computed by Nixara, accepted by the checker ────────────
console.log("\nDerived figures - margins and shares are computed, listed, and verifiable");
{
  const cats = ["Technology", "Furniture", "Office Supplies"];
  const rows: Row[] = Array.from({ length: 90 }, (_, i) => ({
    Category: cats[i % 3],
    Sales: 100 + i,
    Profit: 10 + (i % 7),
  }));
  const ds: Dataset = { rows, columns: ["Category", "Sales", "Profit"] };
  const sum = (k: string) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const expectedMargin = (sum("Profit") / sum("Sales")) * 100;

  const derived = computeDerivedFigures(ds);
  const margin = derived.find((d) => d.kind === "ratio" && d.label === "Profit as % of Sales");
  check("a profit-as-%-of-sales ratio is computed", margin !== undefined);
  check("...and equals total Profit / total Sales", margin !== undefined && Math.abs(margin.value - expectedMargin) < 0.011, String(margin?.value));
  const salesShares = derived.filter((d) => d.set === "Share of total Sales by Category");
  check("shares of total are produced per category", salesShares.length === 3, String(salesShares.length));
  check("...and add up to 100%", Math.abs(salesShares.reduce((s, d) => s + d.value, 0) - 100) < 0.05);

  const summary = buildDataSummary(ds);
  check("the summary the model reads lists the derived figures", summary.includes("DERIVED FIGURES"));
  check("...including the margin to 2 decimals, exactly as the checker will hold it to",
    summary.includes(`Profit as % of Sales: ${expectedMargin.toFixed(2)}%`), summary);

  // Shares of a total with a loss-making group are misleading: skipped.
  const negRows: Row[] = rows.map((r, i) => ({ ...r, Profit: i % 3 === 2 ? -(10 + (i % 7)) : 10 + (i % 7) }));
  const negDerived = computeDerivedFigures({ rows: negRows, columns: ds.columns });
  check("no 'share of total Profit' when a category's profit is negative",
    negDerived.filter((d) => d.set?.startsWith("Share of total Profit")).length === 0);

  // The budget guard: a very wide dataset must never get a derived block that
  // could push the summary past the server's 8,000-char cap.
  const wideCols = Array.from({ length: 150 }, (_, i) => `m${i}`);
  const wideRows: Row[] = rows.slice(0, 30).map((r, i) => {
    const o: Row = { Category: r.Category, Sales: r.Sales, Profit: r.Profit };
    wideCols.forEach((c, k) => (o[c] = (i * 7 + k) % 50));
    return o;
  });
  const wide = buildDataSummary({ rows: wideRows, columns: ["Category", "Sales", "Profit", ...wideCols] });
  check("a very wide dataset gets no derived block (budget guard)", !wide.includes("DERIVED FIGURES"));

  // The checker and the prompt now agree: a correct computed margin is NOT flagged.
  const facts = buildEvidenceFacts(ds);
  check("the fact index contains the margin, marked as calculated",
    facts.some((f) => f.isPercent && f.formula !== undefined && Math.abs(f.value - expectedMargin) < 0.011));
  const good = `Overall, profit is ${expectedMargin.toFixed(2)}% of sales.`;
  check("a correct derived margin is no longer flagged as unverified", findUnverifiedLines(good, facts).length === 0, JSON.stringify(findUnverifiedLines(good, facts)));
  const bad = `Overall, profit is ${expectedMargin.toFixed(2)}% of sales, but returns hit 77.77% in one region.`;
  check("an invented figure on the same line is still flagged", findUnverifiedLines(bad, facts).length === 1);
  check("findUnverifiedFigures names exactly the unmatched figure, not the matched one",
    JSON.stringify(findUnverifiedFigures(bad, facts)) === JSON.stringify(["77.77%"]), JSON.stringify(findUnverifiedFigures(bad, facts)));
}

// ── Evidence facts must rank metrics the same way the prompt does ──────────
// BUG FIX (2026-10): buildDataSummary() ranks business metrics (amount
// columns first) to decide what BREAKDOWN/CROSS-BREAKDOWN sections show the
// model; buildEvidenceFacts() used to independently pick its own "top 4" by
// raw column order instead of using that ranking. So an amount column
// sitting late in the file -- buried behind several mean-type columns, the
// way "annual_medical_cost_usd" was the LAST of 9 numeric columns in a real
// medical-insurance dataset, yet the #2-ranked metric -- got correctly
// prioritised into what the model saw, but never got a single category-
// breakdown fact built for it on the verification side. A correct, cited
// figure for that column was then always flagged "unverified." This is a
// generic architecture fix (see rankedBusinessMetrics in data-analysis.ts),
// not specific to that dataset -- this regression proves it with a
// synthetic dataset shaped the same way, independent of any real CSV.
console.log("\nbuildEvidenceFacts ranks metrics the same way buildDataSummary does, even when the amount column is last in the file");
{
  const regions = ["North", "South"];
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
    Region: regions[i % 2],
    Age: 20 + (i % 50),
    Bmi: 18 + (i % 20),
    Duration: 1 + (i % 10),
    Rating: 1 + (i % 5),
    Score: 10 + (i % 90),
    Revenue: 1000 + i * 37, // the only sum-type, amount-shaped column -- deliberately last
  }));
  const ds: Dataset = { rows, columns: ["Region", "Age", "Bmi", "Duration", "Rating", "Score", "Revenue"] };

  const summary = buildDataSummary(ds);
  const northRevenue = rows.filter((r) => r.Region === "North").reduce((s, r) => s + (r.Revenue as number), 0);
  check("the prompt's BREAKDOWN section includes Revenue by Region even though Revenue is the last column",
    summary.includes("Revenue by Region:") && summary.includes(`North=${northRevenue.toFixed(2)}`), summary.slice(0, 2000));

  const facts = buildEvidenceFacts(ds);
  check("buildEvidenceFacts also builds a Revenue-by-Region fact for the same figure",
    facts.some((f) => !f.isPercent && Math.abs(f.value - northRevenue) < 0.05 && f.description.includes("Revenue")),
    JSON.stringify(facts.filter((f) => f.description.includes("Revenue"))));

  const cited = `Region North brought in $${northRevenue.toFixed(2)} in revenue.`;
  check("a real Revenue-by-Region figure now verifies, not just stats on the whole column",
    findUnverifiedLines(cited, facts).length === 0, JSON.stringify(findUnverifiedLines(cited, facts)));
}

// ── Suggested outcome rating ────────────────────────────────────────────────
console.log("\nSuggested outcome rating - visible rule, never a default");
{
  const rate = (b: number | null, a: number | null, t: number | null) => suggestOutcomeRating(b, a, t);
  check("no target -> no suggestion and nothing to explain", rate(1200, 1260, null).suggestion === null && rate(1200, 1260, null).reason === null);
  check("1,200 -> 1,260 against a 1,300 target is Met (3.1% below)",
    rate(1200, 1260, 1300).suggestion?.rating === "met" && rate(1200, 1260, 1300).suggestion!.rule.includes("3.1% below"), JSON.stringify(rate(1200, 1260, 1300)));
  check("past the target in the aimed direction is Exceeded", rate(1200, 1400, 1300).suggestion?.rating === "exceeded");
  check("more than 5% short is Fell short", rate(1200, 1100, 1300).suggestion?.rating === "missed");
  check("exactly 5% off the target still counts as Met (no floating-point flip)", rate(1200, 1235, 1300).suggestion?.rating === "met");
  check("aiming DOWN (churn 10 -> 5): beating the target is Exceeded", rate(10, 4, 5).suggestion?.rating === "exceeded");
  check("aiming DOWN: ending above the target is Fell short", rate(10, 7, 5).suggestion?.rating === "missed");
  check("aiming DOWN: within 5% is Met", rate(10, 5.2, 5).suggestion?.rating === "met");
  check("a target without a Value BEFORE explains why there is no suggestion", rate(null, 1260, 1300).suggestion === null && rate(null, 1260, 1300).reason !== null);
  check("a target of 0 explains why there is no suggestion", rate(10, 4, 0).reason !== null);
  check("a target equal to Value BEFORE cannot imply a direction, and says so", rate(1200, 1260, 1200).suggestion === null && rate(1200, 1260, 1200).reason !== null);
}

// ── Metric selection: the coaster_db "Opening date" bug ─────────────────────
console.log("metric selection - sparse and non-quantity columns");

/**
 * Reproduces the shape of coaster_db.csv's 'Opening date': one column holding
 * numbers, text and Dates at once. Papa's dynamicTyping types cells, not
 * columns, so this is what a messy real-world date column actually looks like
 * by the time it reaches the analysis layer.
 */
const messyRows: Row[] = [
  ...Array.from({ length: 16 }, (_, i) => ({ Status: "Operating", "Opening date": `December ${1900 + i}` })),
  ...Array.from({ length: 4 },  (_, i) => ({ Status: "Operating", "Opening date": 1980 + i })),
  ...Array.from({ length: 10 }, () => ({ Status: "Closed", "Opening date": "March 4, 1971" })),
];
const messy: Dataset = { rows: messyRows, columns: ["Status", "Opening date"] };

check("a 20%-numeric column is not a numeric column",
  !numericColumns(messy).includes("Opening date"),
  `density = ${(numericDensity(messy, "Opening date") * 100).toFixed(0)}%`);
check("and is never offered as a business metric",
  !businessMetricColumns(messy).includes("Opening date"));
check("so nothing charts it",
  !pickChartSpecs(messy, "opening date by status").some((s) => s.title.includes("Opening Date")));

// A fully-numeric year column is still a coordinate, not an amount.
const years: Dataset = {
  columns: ["Region", "year_introduced"],
  rows: Array.from({ length: 20 }, (_, i) => ({ Region: i % 2 ? "A" : "B", year_introduced: 1990 + i })),
};
check("a complete year column is excluded as a metric",
  !businessMetricColumns(years).includes("year_introduced"));
check("isNonQuantityColumn agrees", isNonQuantityColumn(years, "year_introduced"));

// A real metric at full coverage is untouched.
const clean: Dataset = {
  columns: ["Region", "Profit"],
  rows: Array.from({ length: 20 }, (_, i) => ({ Region: i % 2 ? "A" : "B", Profit: 100 + i })),
};
check("a complete numeric metric still qualifies", businessMetricColumns(clean).includes("Profit"));

// Coverage threshold: 85% in, 60% out.
const mk = (numeric: number, text: number): Dataset => ({
  columns: ["Region", "Amount"],
  rows: [
    ...Array.from({ length: numeric }, (_, i) => ({ Region: "A", Amount: 10 + i })),
    ...Array.from({ length: text }, () => ({ Region: "A", Amount: "n/a" })),
  ],
});
check("85% numeric clears MIN_METRIC_COVERAGE", businessMetricColumns(mk(17, 3)).includes("Amount"));
check("60% numeric does not", !businessMetricColumns(mk(12, 8)).includes("Amount"));

// ── Coverage reporting ──────────────────────────────────────────────────────
console.log("aggregateBy - coverage and aggregation are reported");

const partial: Dataset = {
  columns: ["Status", "Score"],
  rows: [
    ...Array.from({ length: 3 }, () => ({ Status: "Operating", Score: 10 })),
    ...Array.from({ length: 7 }, () => ({ Status: "Operating", Score: "unknown" })),
    ...Array.from({ length: 5 }, () => ({ Status: "Closed", Score: 20 })),
  ],
};
const res = aggregateBy(partial, "Status", "Score");
const op = res.points.find((p) => p.key === "Operating")!;
check("a group reports rows used vs rows present", op.used === 3 && op.total === 10,
  `used=${op.used} total=${op.total}`);
check("a complete group reports full coverage",
  (() => { const c = res.points.find((p) => p.key === "Closed")!; return c.used === 5 && c.total === 5; })());
check("the whole aggregation reports coverage", res.used === 8 && res.total === 15,
  `used=${res.used} total=${res.total}`);
check("the aggregation used is reported", res.agg === "mean" || res.agg === "sum");

// ── Pie charts are only for totals ──────────────────────────────────────────
console.log("chart shape - pie means parts of a whole");

const sums: Dataset = {
  columns: ["Region", "Sales"],
  rows: ["A", "B", "C", "D"].flatMap((r) =>
    Array.from({ length: 5 }, (_, i) => ({ Region: r, Sales: 100 + i }))),
};
const sumSpec = pickChartSpecs(sums, "sales by region")[0];
check("a summed metric with few categories may be a pie", sumSpec?.type === "pie", String(sumSpec?.type));
check("and its title says Total", !!sumSpec?.title.startsWith("Total "), sumSpec?.title ?? "");

const means: Dataset = {
  columns: ["Region", "Win Rate"],
  rows: ["A", "B", "C", "D"].flatMap((r) =>
    Array.from({ length: 5 }, (_, i) => ({ Region: r, "Win Rate": 0.4 + i / 100 }))),
};
const meanSpec = pickChartSpecs(means, "win rate by region")[0];
check("an averaged metric is never a pie", meanSpec?.type !== "pie", String(meanSpec?.type));
check("and its title says Average of", !!meanSpec?.title.startsWith("Average of "), meanSpec?.title ?? "");
check("aggWord labels both operations", aggWord("sum") === "Total" && aggWord("mean") === "Average of");

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
