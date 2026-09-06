/**
 * Regression tests for the data-correctness fixes.
 *
 * Run with:  npm run test:correctness
 *
 * Each case maps to a specific bug. A failure here means a number in a
 * generated report is wrong, which is the failure mode that costs credibility
 * with a finance-trained reader.
 */

import { smartAgg, numericStats, aggregateBy, type Dataset } from "../lib/data-analysis.ts";

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

const byDiscount = aggregateBy(dataset, "Region", "Discount");
const central = byDiscount.find((d) => d.key === "Central")!;
check("Discount is averaged, not summed", Math.abs(central.value - 0.3) < 1e-9,
  `Central Discount = ${central.value} (summed would be 0.6)`);

const bySales = aggregateBy(dataset, "Region", "Sales");
check("Sales is still summed",
  bySales.find((d) => d.key === "Central")!.value === 400,
  String(bySales.find((d) => d.key === "Central")!.value));

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
