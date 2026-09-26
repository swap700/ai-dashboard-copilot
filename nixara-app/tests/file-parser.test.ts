/**
 * Regression test for the CSV-sanitization number-corruption bug.
 *
 * Run with:  npm run test:file-parser
 *
 * BUG: sanitizeCell() (formula-injection guard) prepended a `'` to ANY
 * string starting with "-", "+", "@", tab, or CR -- including a plain
 * negative number that PapaParse's dynamicTyping left as a string because
 * it had a thousands-separator comma (e.g. "-1,500.87"). The corrupted
 * "'-1,500.87" then failed cleanDataset's numeric parse and silently became
 * `null` ("missing data"), and was dropped from every sum -- on a real
 * dataset this turned a region's correct $94,883.24 profit total into a
 * fabricated $128,982.68, and a column with zero blanks into a reported
 * "35 missing values" data-quality flag.
 */
import { parseCsvText } from "../lib/file-parser.ts";
import { cleanDataset } from "../lib/data-analysis.ts";

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

console.log("sanitizeCell - negative/comma-formatted numbers survive intact");

// A quoted negative number with a thousands separator -- exactly the shape
// that triggered the bug (Papa's dynamicTyping regex has no comma support,
// so this arrives at sanitizeCell as a raw string, not a pre-converted number).
const csv1 = `Region,Profit\nEast,"-1,500.87"\nEast,"8,710.02"\nEast,-670.58\n`;
const parsed1 = cleanDataset(parseCsvText(csv1));
const profits = parsed1.rows.map((r) => r.Profit);
check("all three Profit values parse as real numbers, none dropped to null",
  profits.every((v) => typeof v === "number" && Number.isFinite(v)),
  JSON.stringify(profits));
check("the comma-formatted negative value keeps its full magnitude (-1500.87, not -1)",
  profits[0] === -1500.87, `got ${profits[0]}`);
check("the comma-formatted positive value keeps its full magnitude (8710.02, not 8)",
  profits[1] === 8710.02, `got ${profits[1]}`);
check("Profit sums correctly across the group (no rows silently excluded)",
  Math.abs((profits as number[]).reduce((a, b) => a + b, 0) - 6538.57) < 1e-6);

console.log("sanitizeCell - genuine formula-injection payloads are still neutralized");

// A real formula-injection attempt in a free-text column must still be
// escaped -- this fix must not weaken that protection for actual formulas.
const csv2 = `Notes\n"=cmd|'/c calc'!A1"\n"+HYPERLINK(""http://evil"",""click"")"\n"-2+3+cmd|' /c calc'!A1"\n`;
const parsed2 = parseCsvText(csv2);
const notes = parsed2.rows.map((r) => String(r.Notes));
check("a formula starting with '=' is still prefixed with a guard quote",
  notes[0].startsWith("'="), notes[0]);
check("a formula starting with '+' is still prefixed with a guard quote",
  notes[1].startsWith("'+"), notes[1]);
check("a formula starting with '-' (not a plain number) is still prefixed with a guard quote",
  notes[2].startsWith("'-"), notes[2]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
