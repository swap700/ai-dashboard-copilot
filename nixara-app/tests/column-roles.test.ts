/**
 * Regression tests for the column-role resolver and the summary-row detector.
 *
 * Run with:  npm run test:column-roles
 *
 * The resolver exists to end one recurring failure: a rule fixed at the call
 * site where someone noticed the bug and left broken everywhere else. So this
 * file tests both halves of each rule -- that the bad case is caught AND that
 * the legitimate lookalike is not. A role filter that is wrong in the other
 * direction throws away the headline metric of a file, which is worse than
 * the bug it was added for.
 */

import { parseCsvText } from "../lib/file-parser.ts";
import {
  prepareDataset, cleanDataset, resolveColumnRoles, columnsWithRole, roleInfo,
  businessMetricColumns, groupingColumns, pickChartSpecs, buildDataSummary,
  rankedBusinessMetrics, detectMalformedEntries, describeUnmeasuredColumns,
  detectAnomalies, dashboardScoreBreakdown, chartableColumns, type Dataset,
} from "../lib/data-analysis.ts";
import { detectAggregateRows } from "../lib/aggregate-rows.ts";
import { parseDateLike } from "../lib/date-format.ts";

let pass = 0;
let fail = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) pass++;
  else { fail++; console.error(`  FAIL  ${name}${detail ? "  ->  " + detail : ""}`); }
}
const load = (csv: string) => prepareDataset(parseCsvText(csv));
const roleOf = (ds: Dataset, col: string) => roleInfo(ds, col)?.role;

/** One numeric column plus a label column, for role tests. */
function withLabel(name: string, values: unknown[], labels = ["A", "B", "C"]): Dataset {
  return {
    columns: [name, "L"],
    rows: values.map((v, i) => ({ [name]: v, L: labels[i % labels.length] })),
  };
}

// ── Identifier vs metric: both directions ───────────────────────────────────
console.log("roles - name and shape must agree before a metric is thrown away");

const IDENTIFIERS: [string, number[]][] = [
  ["Student_ID", Array.from({ length: 60 }, (_, i) => 90000 + i)],
  ["Row ID", Array.from({ length: 60 }, (_, i) => i + 1)],
  ["Customer ID", Array.from({ length: 60 }, (_, i) => 4000 + i)],
  ["Store Code", Array.from({ length: 60 }, (_, i) => 400 + i)],
  // Not English. Shape alone cannot settle these, and no English pattern
  // knows them, so the compound-word forms are matched as substrings.
  ["Bestellnummer", Array.from({ length: 60 }, (_, i) => 5000 + i)],
  ["Numero de pedido", Array.from({ length: 60 }, (_, i) => 7000 + i)],
];
for (const [name, values] of IDENTIFIERS) {
  check(`${name} is an identifier`, roleOf(withLabel(name, values), name) === "identifier",
    roleInfo(withLabel(name, values), name)?.reason);
}

// Every one of these was being excluded as an identifier before Oct 2026,
// and every one is the headline metric of some real file.
const REAL_METRICS: [string, number[]][] = [
  ["Patient Count", Array.from({ length: 60 }, (_, i) => [3, 7, 2, 5, 9, 4][i % 6])],
  ["Platelet Count", Array.from({ length: 60 }, (_, i) => [150, 220, 180, 310, 260, 190][i % 6])],
  ["Number of Units Sold", Array.from({ length: 60 }, (_, i) => [12, 40, 7, 22, 31, 5][i % 6])],
  ["Number of Claims", Array.from({ length: 60 }, (_, i) => [1, 4, 2, 9, 3, 6][i % 6])],
  ["Consumer Price Index", Array.from({ length: 60 }, (_, i) => 102.3 + (i % 17) / 10)],
  ["Customer Satisfaction Index", Array.from({ length: 60 }, (_, i) => 70 + (i % 23) / 2)],
  ["Key Accounts Revenue", Array.from({ length: 60 }, (_, i) => 15000.5 + i * 37.2)],
  // A sorted or whole-dollar amount column: near-unique integers, which an
  // earlier draft of the shape test swallowed on its own.
  ["Sales", Array.from({ length: 60 }, (_, i) => 100 + i)],
  ["Umsatz", Array.from({ length: 60 }, (_, i) => 100 + i * 7)],
  ["Price", Array.from({ length: 60 }, (_, i) => [120, 340, 99, 780, 210, 455][i % 6])],
];
for (const [name, values] of REAL_METRICS) {
  check(`${name} is still a metric`, roleOf(withLabel(name, values), name) === "metric",
    roleInfo(withLabel(name, values), name)?.reason);
}

check("a distinct-count column is not addable across rows",
  roleOf(withLabel("Distinct count of Customer ID", Array.from({ length: 60 }, (_, i) => [600, 399, 500, 420, 380, 610][i % 6])),
    "Distinct count of Customer ID") === "identifier");
check("a rank column is not addable either",
  roleOf(withLabel("Rank", Array.from({ length: 60 }, (_, i) => 1 + (i % 10))), "Rank") === "identifier");

// The case neither name nor uniqueness can settle: repeated small integers in
// a column whose name says "number", each tied to exactly one named thing.
const taskNumbers: Dataset = {
  columns: ["TASK_NUMBER", "TASK_NAME"],
  rows: Array.from({ length: 30 }, (_, i) => ({
    TASK_NUMBER: (i % 3) + 1,
    TASK_NAME: ["Discovery", "Build", "Deploy"][i % 3],
  })),
};
check("a number tied one-to-one to a named thing is that thing's id",
  roleOf(taskNumbers, "TASK_NUMBER") === "identifier", roleInfo(taskNumbers, "TASK_NUMBER")?.reason);
const wardCounts: Dataset = {
  columns: ["Patient Count", "Ward"],
  rows: Array.from({ length: 30 }, (_, i) => ({
    "Patient Count": [3, 7, 2, 5, 9][i % 5],
    Ward: ["A", "B", "C"][i % 3],
  })),
};
check("a count that varies within a label is not an id",
  roleOf(wardCounts, "Patient Count") === "metric", roleInfo(wardCounts, "Patient Count")?.reason);

// ── Dates: a density test, not .some() ──────────────────────────────────────
console.log("roles - one stray Date cell must not delete a metric");

const strayDate: Dataset = {
  columns: ["Amount", "Region"],
  rows: Array.from({ length: 50 }, (_, i) => ({
    Amount: i === 7 ? new Date("2025-03-01") : [120, 340, 99, 780, 210, 455][i % 6],
    Region: ["A", "B"][i % 2],
  })),
};
check("a column with one Date cell in fifty is still a metric",
  roleOf(strayDate, "Amount") === "metric", roleInfo(strayDate, "Amount")?.reason);
check("and it is reported as a metric to callers", businessMetricColumns(strayDate).includes("Amount"));

const realDates: Dataset = {
  columns: ["Booked", "Region"],
  rows: Array.from({ length: 50 }, (_, i) => ({
    Booked: i < 45 ? new Date(2025, i % 12, 1) : "unknown",
    Region: ["A", "B"][i % 2],
  })),
};
check("a column that really is mostly Dates is a date column",
  roleOf(realDates, "Booked") === "date");
check("a date written as text is a date column too",
  roleOf({ columns: ["When"], rows: Array.from({ length: 20 }, (_, i) => ({ When: `${(i % 12) + 1}/15/2025` })) }, "When") === "date");
check("Oracle's DD-MON-YYYY is a date column",
  roleOf({ columns: ["When"], rows: Array.from({ length: 20 }, (_, i) => ({ When: `${(i % 28) + 1}-MAR-2025` })) }, "When") === "date");
check("Year_of_Study is NOT a date, whatever its name suggests",
  roleOf({ columns: ["Year_of_Study"], rows: Array.from({ length: 20 }, (_, i) => ({ Year_of_Study: ["1st Year", "2nd Year", "3rd Year"][i % 3] })) }, "Year_of_Study") === "label");

// ── Charts and the summary must read the SAME list ──────────────────────────
console.log("roles - the chart picker and the summary builder agree");

const dateAndLabel = load("When,Region,Sales\n" + Array.from({ length: 18 }, (_, i) =>
  `${(i % 12) + 1}/15/2025,${["N", "S", "E"][i % 3]},${[120, 340, 99, 780, 210, 455][i % 6]}`).join("\n"));
// A date column may key a TREND (that is what a date is for, and since
// Oct 2026 a text date is parsed into real Dates so CSV uploads finally get
// one). What it must never key is a CATEGORY axis, where it would be read as
// a set of labels.
const categoryCharts = pickChartSpecs(dateAndLabel, "sales").filter((s) => s.type !== "area");
check("a date-as-text column never keys a category axis",
  !categoryCharts.some((s) => /by When/.test(s.title)),
  categoryCharts.map((s) => s.title).join(", "));
check("but it does key a trend over time",
  pickChartSpecs(dateAndLabel, "sales").some((s) => s.type === "area" && /by When/.test(s.title)),
  pickChartSpecs(dateAndLabel, "sales").map((s) => `${s.type}:${s.title}`).join(", "));
check("the real label column keys the category chart",
  categoryCharts.some((s) => /by Region/.test(s.title)));

const mostlyBlank = load("Website,Region,Sales\n" + Array.from({ length: 60 }, (_, i) =>
  `${i < 3 ? `site${i}.com` : ""},${["N", "S", "E"][i % 3]},${[120, 340, 99, 780, 210, 455][i % 6]}`).join("\n"));
check("a 95%-blank column never keys a chart",
  !pickChartSpecs(mostlyBlank, "sales").some((s) => /by Website/.test(s.title)),
  pickChartSpecs(mostlyBlank, "sales").map((s) => s.title).join(", "));
check("and it is not offered as a group key either", !groupingColumns(mostlyBlank).includes("Website"));
check("every category chart is keyed on a label column", (() => {
  const labels = groupingColumns(dateAndLabel);
  // area is keyed on a date and scatter on two metrics, by design.
  return pickChartSpecs(dateAndLabel, "", 4)
    .filter((s) => s.type !== "area" && s.type !== "scatter")
    .every((s) => labels.some((l) => s.title.includes(l.replace(/_/g, " "))));
})(), pickChartSpecs(dateAndLabel, "", 4).map((s) => `${s.type}:${s.title}`).join(" | "));

// ── A non-English export ────────────────────────────────────────────────────
console.log("roles - a file with no English column names still works");

const german = load("Bestellnummer;Menge;Umsatz;Region\n" + Array.from({ length: 30 }, (_, i) =>
  `${5000 + i};${1 + (i % 9)};${[1200, 3400, 990, 7800, 2100, 4550][i % 6]};${["Nord", "Sued", "Ost"][i % 3]}`).join("\n"));
check("the order number is not a metric", !businessMetricColumns(german).includes("Bestellnummer"),
  businessMetricColumns(german).join(", "));
check("and is not the primary metric", rankedBusinessMetrics(german).primaryMetric !== "Bestellnummer",
  String(rankedBusinessMetrics(german).primaryMetric));
check("the real amount columns are metrics",
  businessMetricColumns(german).includes("Umsatz") && businessMetricColumns(german).includes("Menge"));
check("Region is the label", groupingColumns(german).includes("Region"));
check("no breakdown is keyed on the order number", !/BY BESTELLNUMMER/.test(buildDataSummary(german)));

// ── Id integrity now runs on snake_case ─────────────────────────────────────
console.log("roles - detectMalformedEntries reaches snake_case columns");

const snake = load("Student_ID,Score\n" + Array.from({ length: 20 }, (_, i) =>
  i === 3 ? `A#1,${50 + i}` : `${900 + i},${50 + i}`).join("\n"));
check("a broken id in a snake_case column is found", detectMalformedEntries(snake).length === 1,
  JSON.stringify(detectMalformedEntries(snake)));
check("and the same data with a space in the header behaves identically",
  detectMalformedEntries(load("Student ID,Score\n" + Array.from({ length: 20 }, (_, i) =>
    i === 3 ? `A#1,${50 + i}` : `${900 + i},${50 + i}`).join("\n"))).length === 1);

// ── Summary rows ────────────────────────────────────────────────────────────
console.log("aggregate rows - a Grand Total row is not an observation");

const totalCsv = "Region,Sales\n" +
  ["East", "West", "North", "South"].flatMap((r) => Array.from({ length: 5 }, () => `${r},100`)).join("\n") +
  "\nGrand Total,2000";
const withTotal = cleanDataset(parseCsvText(totalCsv));
const withoutTotal = prepareDataset(parseCsvText(totalCsv));
check("the total row is removed", withTotal.rows.length === 21 && withoutTotal.rows.length === 20,
  `${withTotal.rows.length} -> ${withoutTotal.rows.length}`);
check("so the file's total is right", /TOTAL=2000\.00/.test(buildDataSummary(withoutTotal)),
  buildDataSummary(withoutTotal).split("\n").find((l) => l.includes("Sales:")) ?? "");
check("it is no longer the biggest category",
  !/Grand Total=/.test(buildDataSummary(withoutTotal)));
check("and no longer the file's one anomaly",
  detectAnomalies(withTotal, "Sales").length === 1 && detectAnomalies(withoutTotal, "Sales").length === 0);
check("the removal is stated in the warnings",
  !!withoutTotal.warnings?.some((w) => w.includes("Grand Total")), JSON.stringify(withoutTotal.warnings));

check("an UNLABELLED total row is caught by arithmetic alone",
  prepareDataset(parseCsvText("Rep,Deals\n" + Array.from({ length: 10 }, (_, i) => `R${i},${10 + i}`).join("\n") + "\n,145")).rows.length === 10);
check("a total row labelled in German is caught",
  prepareDataset(parseCsvText("Region;Umsatz\n" + ["Nord", "Sued", "Ost"].flatMap((r) =>
    Array.from({ length: 4 }, () => `${r};1.000`)).join("\n") + "\nGesamtsumme;12.000")).rows.length === 12);
check("interleaved subtotals are caught",
  prepareDataset(parseCsvText("Region,Sales\n" + ["East", "West"].flatMap((r) =>
    [...Array.from({ length: 5 }, () => `${r},100`), "Subtotal,500"]).join("\n"))).rows.length === 10);

// The other direction. Removing real rows is worse than keeping a total row.
check("a customer named \"Total Fitness Ltd\" is kept",
  detectAggregateRows(cleanDataset(parseCsvText(
    "Customer,Sales\nTotal Fitness Ltd,100\nAcme,200\nBeta,300\nGamma,400\nDelta,500\nEpsilon,600\nZeta,700"))).length === 0);
check("a column simply named Total does not make every row a total",
  prepareDataset(parseCsvText("Region,Total\nEast,100\nWest,200\nNorth,300\nSouth,400")).rows.length === 4);
check("a three-row file where 5 + 10 = 15 is left alone",
  prepareDataset(parseCsvText("Item,Qty\nA,5\nB,10\nC,15")).rows.length === 3);
check("a pre-aggregated report is never gutted", (() => {
  const pivot = parseCsvText("Region,Sales\n" + Array.from({ length: 6 }, (_, i) => `R${i},${100 * (i + 1)}`).join("\n"));
  return prepareDataset(pivot).rows.length === 6;
})());
check("an empty file does not crash", detectAggregateRows({ rows: [], columns: ["A"] }).length === 0);

// ── The resolver is the one source of truth ─────────────────────────────────
console.log("roles - every consumer reads the same answer");

const mixedFile = load("Region,Order Date,Order ID,Revenue,Notes\n" + Array.from({ length: 40 }, (_, i) =>
  `${["N", "S", "E", "W"][i % 4]},${(i % 12) + 1}/15/2025,${8000 + i},${[1200, 3400, 990, 7800][i % 4]},${i < 2 ? "note" : ""}`).join("\n"));
const resolved = resolveColumnRoles(mixedFile);
check("roles cover every column", mixedFile.columns.every((c) => resolved.has(c)));
check("businessMetricColumns equals the metric role",
  JSON.stringify(businessMetricColumns(mixedFile)) === JSON.stringify(columnsWithRole(mixedFile, "metric")));
check("groupingColumns equals the label role",
  JSON.stringify(groupingColumns(mixedFile)) === JSON.stringify(columnsWithRole(mixedFile, "label")));
check("describeUnmeasuredColumns quotes the resolver's own reason", (() => {
  const u = describeUnmeasuredColumns(mixedFile);
  return u.every((x) => x.detail === resolved.get(x.column)?.reason);
})());
check("a resolved metric never appears as unmeasured", (() => {
  const metrics = new Set(businessMetricColumns(mixedFile));
  return describeUnmeasuredColumns(mixedFile).every((u) => !metrics.has(u.column));
})());

// ── The quality score answers "can I decide from this file" ────────────────
console.log("quality score - a file you can analyse must never score below one you cannot");

function scoreOf(ds: Dataset): number {
  return dashboardScoreBreakdown(ds).score;
}

const cleanFile = load("Region,Category,Sales,Profit\n" + Array.from({ length: 200 }, (_, i) =>
  `${["N", "S", "E", "W"][i % 4]},${["A", "B"][i % 2]},${[120, 340, 99, 780][i % 4]},${[10, 25, 7, 40][i % 4]}`).join("\n"));
const noMetricFile: Dataset = {
  columns: ["Order ID", "Region", "Signed on", "Contract Value"],
  rows: Array.from({ length: 100 }, (_, i) => ({
    "Order ID": 1000 + i, Region: ["N", "S", "E"][i % 3],
    "Signed on": i < 30 ? 45000 + i : `2026-0${(i % 9) + 1}-15`,
    "Contract Value": i < 40 ? 5000 + i * 10 : "",
  })),
};
const noLabelFile = load("Amount\n" + Array.from({ length: 40 }, (_, i) => `${100 + i * 7}`).join("\n"));
const messyButUsable = load("Region,Sales,Junk\n" + Array.from({ length: 60 }, (_, i) =>
  `${["N", "S", "E"][i % 3]},${[120, 340, 99][i % 3]},${i < 4 ? "x" : ""}`).join("\n"));

// The inversion this rebuild existed to fix: before Oct 2026 coaster_db
// scored 17 while a file with no usable metric at all scored 43.
check("a file that cannot be analysed scores below one that can",
  scoreOf(noMetricFile) < scoreOf(messyButUsable),
  `${scoreOf(noMetricFile)} vs ${scoreOf(messyButUsable)}`);
check("and says why in plain English",
  dashboardScoreBreakdown(noMetricFile).reasons.some((r) => r.key === "noMeasurableMetric"));
check("a clean file still scores 100", scoreOf(cleanFile) === 100, String(scoreOf(cleanFile)));
check("numbers with nothing to group them by is a real limitation",
  dashboardScoreBreakdown(noLabelFile).reasons.some((r) => r.key === "noGroupingColumn"),
  JSON.stringify(dashboardScoreBreakdown(noLabelFile).reasons.map((r) => r.key)));
check("but still scores better than having no numbers at all",
  scoreOf(noLabelFile) > scoreOf(noMetricFile), `${scoreOf(noLabelFile)} vs ${scoreOf(noMetricFile)}`);
check("placeholder text counts as blank for the score, same as everywhere else",
  dashboardScoreBreakdown({
    columns: ["Region", "Sales"],
    rows: Array.from({ length: 20 }, (_, i) => ({ Region: ["N", "S"][i % 2], Sales: i < 14 ? "N/A" : 100 + i })),
  }).missingRatio > 0.3);
check("every reason names the column it is about", (() => {
  const ds = load("Region,Sales,Gappy\n" + Array.from({ length: 60 }, (_, i) =>
    `${["N", "S", "E"][i % 3]},${[120, 340, 99][i % 3]},${i < 10 ? i : ""}`).join("\n"));
  return dashboardScoreBreakdown(ds).reasons
    .filter((r) => r.key === "sparseColumn" || r.key === "gappyColumn" || r.key === "mixedTypeColumn")
    .every((r) => ds.columns.some((c) => r.message.includes(c)));
})());

// ── Charts: no silent substitution, no silent refusal ──────────────────────
console.log("charts - a big column is collapsed, not swapped out from under you");

const manyPlaces = load("Place,Region,Sales\n" + Array.from({ length: 300 }, (_, i) =>
  `Place ${i % 120},${["N", "S", "E"][i % 3]},${[120, 340, 99, 780][i % 4]}`).join("\n"));
const placeChart = pickChartSpecs(manyPlaces, "Place")[0];
check("a 120-value column is charted rather than skipped",
  !!placeChart && /by Place/.test(placeChart.title), placeChart?.title ?? "(none)");
check("its tail is collapsed into one Other bar",
  !!placeChart && placeChart.data.some((d) => d.key.startsWith("Other (")),
  placeChart?.data.map((d) => d.key).join(", ") ?? "");
check("and the chart says so", !!placeChart?.note?.includes("grouped as Other"), placeChart?.note ?? "(no note)");
check("the Other bar carries the rows it stands for",
  (() => {
    const other = placeChart?.data.find((d) => d.key.startsWith("Other ("));
    return !!other && other.total > 0 && other.used > 0;
  })());
check("a small column is NOT collapsed",
  !pickChartSpecs(manyPlaces, "Region")[0]?.data.some((d) => d.key.startsWith("Other (")),
  pickChartSpecs(manyPlaces, "Region")[0]?.data.map((d) => d.key).join(", ") ?? "");

check("typing a column name charts that column",
  /by Region/.test(pickChartSpecs(manyPlaces, "sales by Region")[0]?.title ?? ""),
  pickChartSpecs(manyPlaces, "sales by Region")[0]?.title ?? "");
check("typing a VALUE from a column charts that column",
  /by Place/.test(pickChartSpecs(manyPlaces, "how is Place 7 doing")[0]?.title ?? ""),
  pickChartSpecs(manyPlaces, "how is Place 7 doing")[0]?.title ?? "");
check("\"X by Y\" groups by Y, not by X", (() => {
  const ds = load("Speed,Maker,Sales\n" + Array.from({ length: 60 }, (_, i) =>
    `S${i % 9},M${i % 5},${[120, 340, 99][i % 3]}`).join("\n"));
  return /by Maker/.test(pickChartSpecs(ds, "speed by maker")[0]?.title ?? "");
})(), pickChartSpecs(load("Speed,Maker,Sales\n" + Array.from({ length: 60 }, (_, i) =>
  `S${i % 9},M${i % 5},${[120, 340, 99][i % 3]}`).join("\n")), "speed by maker")[0]?.title ?? "");
check("with no question, the default is a readable column rather than file order",
  (() => {
    const spec = pickChartSpecs(manyPlaces, "")[0];
    return !!spec && /by Region/.test(spec.title);
  })(), pickChartSpecs(manyPlaces, "")[0]?.title ?? "");

check("chartableColumns tells the user what exists and how big it is", (() => {
  const list = chartableColumns(manyPlaces);
  const place = list.find((c) => c.column === "Place");
  const region = list.find((c) => c.column === "Region");
  return !!place && place.collapses && place.distinct === 120 && !!region && !region.collapses;
})(), JSON.stringify(chartableColumns(manyPlaces)));
check("and lists the most readable column first",
  chartableColumns(manyPlaces)[0]?.column === "Region", chartableColumns(manyPlaces)[0]?.column);

// ── Dates become real dates, so a CSV can finally show a trend ─────────────
console.log("dates - a trend over time used to be impossible for any CSV");

check("a US-style text date column becomes real Dates", (() => {
  const ds = load("When,Sales\n" + Array.from({ length: 24 }, (_, i) =>
    `${(i % 12) + 1}/15/2026,${100 + i}`).join("\n"));
  return ds.rows.every((r) => r.When instanceof Date);
})());
check("and a trend chart appears, which never happened for a CSV before", (() => {
  const ds = load("When,Sales\n" + Array.from({ length: 24 }, (_, i) =>
    `${(i % 12) + 1}/15/2026,${100 + i}`).join("\n"));
  return pickChartSpecs(ds, "", 4).some((c) => c.type === "area");
})());
check("day-first is settled by a single day past the 12th", (() => {
  // 25/03 can only be day-first. Every other row must follow that decision.
  const ds = load("When,Sales\n25/03/2026,100\n04/03/2026,110\n05/03/2026,120\n06/03/2026,130");
  const d = ds.rows[1].When as Date;
  return d instanceof Date && d.getUTCMonth() === 2 && d.getUTCDate() === 4;
})(), String(load("When,Sales\n25/03/2026,100\n04/03/2026,110\n05/03/2026,120\n06/03/2026,130").rows[1].When));
check("month-first is settled the same way", (() => {
  const ds = load("When,Sales\n03/25/2026,100\n03/04/2026,110\n03/05/2026,120\n03/06/2026,130");
  const d = ds.rows[1].When as Date;
  return d instanceof Date && d.getUTCMonth() === 2 && d.getUTCDate() === 4;
})());
check("ISO dates need no guessing", (() => {
  const ds = load("When,Sales\n" + Array.from({ length: 12 }, (_, i) =>
    `2026-${String((i % 12) + 1).padStart(2, "0")}-15,${100 + i}`).join("\n"));
  const d = ds.rows[0].When as Date;
  return d instanceof Date && d.getUTCFullYear() === 2026 && d.getUTCDate() === 15;
})());
check("an impossible date is rejected rather than rolled into next month",
  parseDateLike("02/31/2026", "month-first") === null);
check("Oracle's DD-MON-YYYY parses", (() => {
  const d = parseDateLike("31-MAR-2025", "month-first");
  return d instanceof Date && d.getUTCMonth() === 2 && d.getUTCDate() === 31;
})());
check("a trend is never drawn from a barely-populated date column", (() => {
  // One date column 5% filled, one 100% filled: coaster_db's exact shape,
  // where the first-match loop used to pick the 5% one.
  const ds = load("Sparse,Full,Sales\n" + Array.from({ length: 40 }, (_, i) =>
    `${i < 2 ? `1/${(i % 28) + 1}/2026` : ""},${(i % 12) + 1}/15/2026,${100 + i}`).join("\n"));
  const area = pickChartSpecs(ds, "", 4).find((c) => c.type === "area");
  return !!area && /by Full/.test(area.title);
})());
check("a file with numbers and dates but no category still gets a chart", (() => {
  const ds = load("When,Amount\n" + Array.from({ length: 20 }, (_, i) =>
    `${(i % 12) + 1}/15/2026,${100 + i * 7}`).join("\n"));
  return pickChartSpecs(ds, "", 4).length > 0;
})());

// ── The two charts built from figures that were already being computed ─────
console.log("charts - scatter and grouped bar");

const twoCats = load("Region,Segment,Sales,Cost\n" + Array.from({ length: 120 }, (_, i) =>
  `${["N", "S", "E", "W"][i % 4]},${["Retail", "Trade"][i % 2]},${[120, 340, 99, 780][i % 4]},${[60, 150, 40, 300][i % 4]}`).join("\n"));
const grouped = pickChartSpecs(twoCats, "", 4).find((c) => c.type === "groupedBar");
check("two low-cardinality labels produce a grouped bar", !!grouped, "(none)");
check("the wider column goes on the axis and the narrower becomes the series",
  grouped?.groups?.names.length === 2 && grouped?.groups?.rows.length === 4,
  `series=${JSON.stringify(grouped?.groups?.names)} rows=${grouped?.groups?.rows.length}`);
check("never more than four series, the colour ceiling", (() => {
  const many = load("Region,Many,Sales\n" + Array.from({ length: 120 }, (_, i) =>
    `${["N", "S"][i % 2]},${["a", "b", "c", "d", "e"][i % 5]},${100 + i}`).join("\n"));
  const g = pickChartSpecs(many, "", 4).find((c) => c.type === "groupedBar");
  return !g || (g.groups?.names.length ?? 0) <= 4;
})());

// Related but not identical: a perfect pair would be caught by the
// duplicate-column filter, which is itself one of the cases tested below.
const wobble = [0, 14, -9, 22, -17, 6, 30, -25, 11, -3];
const correlated = load("A,B,Label\n" + Array.from({ length: 80 }, (_, i) =>
  `${i * 3 + wobble[i % wobble.length]},${i * 5 + wobble[(i * 3) % wobble.length] * 4},${["x", "y"][i % 2]}`).join("\n"));
const scatter = pickChartSpecs(correlated, "", 4).find((c) => c.type === "scatter");
check("two related metrics produce a scatter", !!scatter, "(none)");
check("it carries the paired points", (scatter?.scatter?.points.length ?? 0) > 10);
check("and states that correlation is not causation",
  !!scatter?.note?.includes("not proof that one causes the other"), scatter?.note ?? "");
check("a duplicate column is not reported as a finding", (() => {
  // Inversions vs Inversions_clean in coaster_db: r = 1.00, which says only
  // that the file has the same column twice.
  const dup = load("A,A_copy,Label\n" + Array.from({ length: 60 }, (_, i) =>
    `${100 + i},${100 + i},${["x", "y"][i % 2]}`).join("\n"));
  return !pickChartSpecs(dup, "", 4).some((c) => c.type === "scatter");
})());
check("an unrelated pair produces no scatter at all", (() => {
  // Deterministic pseudo-random, so the test cannot flake.
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const rows = Array.from({ length: 200 }, (_, i) =>
    `${Math.round(next() * 1000)},${Math.round(next() * 1000)},${["x", "y"][i % 2]}`);
  const ds = load("A,B,Label\n" + rows.join("\n"));
  return !pickChartSpecs(ds, "", 4).some((c) => c.type === "scatter");
})());
check("a scatter never pairs an identifier with a metric", (() => {
  const ds = load("Row ID,Sales,Label\n" + Array.from({ length: 60 }, (_, i) =>
    `${i + 1},${100 + i},${["x", "y"][i % 2]}`).join("\n"));
  const sc = pickChartSpecs(ds, "", 4).find((c) => c.type === "scatter");
  return !sc || (sc.scatter?.x !== "Row ID" && sc.scatter?.y !== "Row ID");
})());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
