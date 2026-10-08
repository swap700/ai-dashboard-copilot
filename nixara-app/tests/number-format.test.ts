/**
 * Regression tests for the column-level number parser (lib/number-format.ts).
 *
 * Run with:  npm run test:number-format
 *
 * Every case here is a real export format. The headline one is the German
 * column: "1.200" read as US format is 1.2, which is a revenue figure wrong by
 * a factor of a thousand with a 100/100 quality score beside it. That is the
 * worst thing this product can do, so it is tested first and tested both ways
 * round -- a US column with thousands separators must never flip to European.
 */

import { parseDecoratedNumber, detectColumnNumberFormat } from "../lib/number-format.ts";
import { parseCsvText } from "../lib/file-parser.ts";
import { cleanDataset, businessMetricColumns, numericDensity, groupingColumns,
         dashboardScoreBreakdown, buildDataSummary, pickChartSpecs } from "../lib/data-analysis.ts";

let pass = 0;
let fail = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) pass++;
  else {
    fail++;
    console.error(`  FAIL  ${name}${detail ? "  ->  " + detail : ""}`);
  }
}
const load = (csv: string) => cleanDataset(parseCsvText(csv));
const col = (ds: ReturnType<typeof load>, c: string) => ds.rows.map((r) => r[c]);

// ── Single-cell reads under a stated style ──────────────────────────────────
console.log("parseDecoratedNumber - one cell, style stated by the caller");

const dot: [string, number | null][] = [
  ["1,234.56", 1234.56], ["$1,234.56", 1234.56], ["-$1,500.87", -1500.87],
  ["$-1,500.87", -1500.87], ["+$1,000.00", 1000], ["(1,234.00)", -1234],
  ["($1,234.00)", -1234], ["1500.87-", -1500.87], ["45%", 0.45], ["-3.2%", -0.032],
  ["1.2e6", 1200000], ["1 234 567.89", 1234567.89], ["1'234'567.89", 1234567.89],
  ["12,000", 12000], ["0", 0], ["-0.5", -0.5], ["1234 EUR", 1234], ["EUR 1234", 1234],
  ["", null], ["   ", null], ["abc", null], ["1,23,456", null], ["02134", null],
];
for (const [raw, want] of dot) {
  const got = parseDecoratedNumber(raw, "dot");
  check(`dot: "${raw}" -> ${want}`, got === want, `got ${got}`);
}

const comma: [string, number | null][] = [
  ["1.234,56", 1234.56], ["1.234.567,89", 1234567.89], ["987,25", 987.25],
  ["1 234,56", 1234.56], ["-1.500,87", -1500.87], ["(1.234,00)", -1234],
  ["45%", 0.45], ["1.200", 1200], ["1234", 1234],
];
for (const [raw, want] of comma) {
  const got = parseDecoratedNumber(raw, "comma");
  check(`comma: "${raw}" -> ${want}`, got === want, `got ${got}`);
}

check("the guard prefix from the formula sanitiser never blocks a read",
  parseDecoratedNumber("'-1,500.87", "dot") === -1500.87,
  String(parseDecoratedNumber("'-1,500.87", "dot")));
check("a unit is only read when the column agreed on one",
  parseDecoratedNumber("12 kg", "dot") === null && parseDecoratedNumber("12 kg", "dot", "kg") === 12);
check("a cell carrying a DIFFERENT unit than the column is rejected, not mixed in",
  parseDecoratedNumber("12 lb", "dot", "kg") === null);
check("a non-finite number is never returned", parseDecoratedNumber(Infinity, "dot") === null);

// ── Column-level format detection ───────────────────────────────────────────
console.log("detectColumnNumberFormat - the style is the column's property, not the cell's");

check("one unambiguous neighbour settles an otherwise ambiguous column",
  detectColumnNumberFormat(["1.200", "1.300", "1.234,56"])?.style === "comma");
check("and the same in reverse",
  detectColumnNumberFormat(["1,200", "1,300", "1,234.56"])?.style === "dot");
check("repeated separators prove which one groups",
  detectColumnNumberFormat(["1.234.567", "2.000.000"])?.style === "comma");
check("a group of other than three digits proves a decimal mark",
  detectColumnNumberFormat(["1,23", "4,56"])?.style === "comma");
check("an end-to-end ambiguous column falls back to dot",
  detectColumnNumberFormat(["1.200", "1.300"])?.style === "dot");
check("unless the file's own delimiter says otherwise",
  detectColumnNumberFormat(["1.200", "1.300"], { delimiter: ";" })?.style === "comma",
  JSON.stringify(detectColumnNumberFormat(["1.200", "1.300"], { delimiter: ";" })));
check("the delimiter hint never overrides real evidence",
  detectColumnNumberFormat(["1,234.56", "9,999.99"], { delimiter: ";" })?.style === "dot");
check("leading-zero identifiers are never a numeric column",
  detectColumnNumberFormat(["02134", "02135", "02136"]) === null);
check("a text column is not a numeric column",
  detectColumnNumberFormat(["North", "South", "East"]) === null);
check("an empty column is not a numeric column", detectColumnNumberFormat([]) === null);
check("a column of real numbers needs no style evidence",
  detectColumnNumberFormat([1, 2, 3])?.coverage === 1);
check("a unit is adopted only when the column agrees",
  detectColumnNumberFormat(["12 kg", "14 kg", "16 kg"])?.traits.unit === "kg" &&
  detectColumnNumberFormat(["12 kg", "14 lb", "16 kg", "18 lb"])?.traits.unit == null);
check("decorations are reported for the UI",
  detectColumnNumberFormat(["($1,000.00)", "$2,000.00"])?.traits.parens === true);
check("rescued cells are counted, so the UI can say how much work was needed",
  (detectColumnNumberFormat(["(1,000.00)", "(2,000.00)"])?.rescued ?? 0) === 1,
  JSON.stringify(detectColumnNumberFormat(["(1,000.00)", "(2,000.00)"])));
check("a cell the old parser could already read is not counted as rescued",
  (detectColumnNumberFormat(["-$1,000.00", "-$2,000.00"])?.rescued ?? 1) === 0);

// ── End to end through the parser the app actually uses ─────────────────────
console.log("cleanDataset - the whole-file path");

// THE headline case. 1.200 is one thousand two hundred, not one point two.
const german = load("Region;Umsatz\n" + Array.from({ length: 20 }, (_, i) => `R${i % 4};1.${200 + i}`).join("\n"));
check("a German semicolon export is read as thousands, not thousandths",
  col(german, "Umsatz")[0] === 1200, String(col(german, "Umsatz")[0]));
check("and the decision is recorded for the UI to state",
  german.numberFormats?.Umsatz.style === "comma" && german.numberFormats?.Umsatz.evidence === "delimiter");
check("a US file with thousands separators is NOT flipped",
  col(load('Region,Revenue\nEast,"1,234.56"\nWest,"12,000.00"\nEast,987.25'), "Revenue")[1] === 12000);

// Excel's own accounting format, which used to null every loss row.
const acct = load("Region,Profit\n" + Array.from({ length: 8 }, (_, i) => `East,${1000 + i}.00`).join("\n") +
  "\n" + Array.from({ length: 4 }, () => `West,"-$1,500.87"`).join("\n"));
check("Excel accounting negatives survive", numericDensity(acct, "Profit") === 1,
  String(numericDensity(acct, "Profit")));
check("so the column is still a metric", businessMetricColumns(acct).includes("Profit"));
check("and the file is not declared unmeasurable",
  !buildDataSummary(acct).includes("NO MEASURABLE METRIC"));
check("the loss total is reported as a loss",
  /West=-6003\.48/.test(buildDataSummary(acct)),
  buildDataSummary(acct).split("\n").find((l) => l.includes("by Region")) ?? "");

// Parenthesised negatives used to make the metric column read as a CATEGORY.
const parens = load("Region,Profit\n" +
  Array.from({ length: 12 }, (_, i) => `${["A", "B", "C"][i % 3]},"(1,1${String(i).padStart(2, "0")}.00)"`).join("\n"));
check("a parenthesised-negative column is a metric, not a label",
  businessMetricColumns(parens).includes("Profit") && !groupingColumns(parens).includes("Profit"),
  `metrics=${businessMetricColumns(parens)} groups=${groupingColumns(parens)}`);
check("and it is never charted as the category axis",
  !pickChartSpecs(parens, "profit").some((s) => /by Profit/.test(s.title)),
  pickChartSpecs(parens, "profit").map((s) => s.title).join(", "));

check("leading-zero ids stay text through the whole pipeline",
  col(load("Zip,Sales\n02134,100\n02135,110\n02136,120\n02140,130"), "Zip")[0] === "02134");

// A column that is part text, part number keeps BOTH halves. The old parser
// overwrote the whole column, reporting a file with no blanks as 40% blank.
const sizes = load("Size\n12\n14\n16\n18\n20\n22\nXL\nL\nM\nS");
check("a mixed column keeps its text values", col(sizes, "Size")[6] === "XL", String(col(sizes, "Size")[6]));
check("and its numbers", col(sizes, "Size")[0] === 12);
check("and is reported as mixed rather than blank",
  dashboardScoreBreakdown(sizes).reasons.some((r) => r.key === "mixedTypeColumn") &&
  !dashboardScoreBreakdown(sizes).reasons.some((r) => r.key === "sparseColumn"),
  dashboardScoreBreakdown(sizes).reasons.map((r) => r.key).join(", "));

// ── The formula-injection guard must still hold ─────────────────────────────
console.log("formula injection - widening the number grammar must not open the guard");

const inj = load('A,B\n"=SUM(A1:A9)",1\n"-1+cmd|\'/c calc\'!A0",2\n"@SUM(1)",3\n"+WEBSERVICE(\\"http://x\\")",4\n"-1,500.87",5\n"-$2,000.00",6\n"(3,000.00)",7');
const aVals = col(inj, "A").map(String);
for (const [i, raw] of [[0, "=SUM"], [1, "-1+cmd"], [2, "@SUM"], [3, "+WEBSERVICE"]] as [number, string][]) {
  check(`a real formula is still neutralised (${raw})`, aVals[i].startsWith("'"), aVals[i]);
}
for (const [i, raw] of [[4, "-1,500.87"], [5, "-$2,000.00"], [6, "(3,000.00)"]] as [number, string][]) {
  check(`a decorated number is not treated as a formula (${raw})`, !aVals[i].startsWith("'"), aVals[i]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
