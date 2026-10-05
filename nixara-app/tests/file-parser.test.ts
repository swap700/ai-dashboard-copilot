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


// ── CSV read checks: an unclosed quote must not silently drop rows ──────────
console.log("\nCSV read checks - unclosed quotes, column-count mismatches");
{
  // 1,000 rows, one value at row 300 opens a quote and never closes it.
  const lines = ["id,name,amount"];
  for (let i = 1; i <= 1000; i++) lines.push(i === 300 ? `${i},"Acme,${i * 10}` : `${i},Customer ${i},${i * 10}`);
  let message = "";
  try {
    parseCsvText(lines.join("\n"));
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  check("an unclosed quote at row 300 is refused instead of silently reading 300 of 1,000 rows", message !== "", "no error was thrown");
  check("the message names the row", message.includes("near row 300"), message);
  check("the message says how much of the file was readable", message.includes("300 of about 1,000 rows"), message);
}
{
  // A closed quote followed by stray text also makes the parser swallow the rest.
  const lines = ["id,name,amount"];
  for (let i = 1; i <= 20; i++) lines.push(i === 4 ? `${i},"Bob"x,${i * 10}` : `${i},Customer ${i},${i * 10}`);
  let threw = false;
  try {
    parseCsvText(lines.join("\n"));
  } catch {
    threw = true;
  }
  check("a quote followed by stray text (which also swallows the rest of the file) is refused", threw);
}
{
  // Wrong column counts lose no rows: keep them all, but warn.
  const lines = ["id,name,amount"];
  for (let i = 1; i <= 20; i++) {
    lines.push(i === 5 || i === 9 ? `${i},OnlyName` : i === 7 ? `${i},A,B,C,D` : `${i},Customer ${i},${i * 10}`);
  }
  const ds = parseCsvText(lines.join("\n"));
  check("rows with the wrong number of columns are all kept", ds.rows.length === 20, String(ds.rows.length));
  check("...and one warning says how many", ds.warnings?.length === 1 && ds.warnings[0].includes("3 rows do not have 3 columns"), JSON.stringify(ds.warnings));
}
{
  // The normal case must be untouched: a quoted value containing a comma.
  const lines = ["id,name,amount"];
  for (let i = 1; i <= 20; i++) lines.push(`${i},"Smith, J",${i * 10}`);
  const ds = parseCsvText(lines.join("\n"));
  check("a correctly quoted value containing a comma reads cleanly", ds.rows.length === 20 && ds.warnings === undefined);
  check("...and keeps the comma inside the value", ds.rows[0].name === "Smith, J");
}
check("cleanDataset keeps the warnings field instead of dropping it",
  cleanDataset({ rows: [], columns: [], warnings: ["x"] }).warnings?.[0] === "x");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
