/**
 * Regression test for lib/format.ts's display helpers.
 *
 * Run with:  npm run test:format
 */
import { joinWithOverflow, formatPercent } from "../lib/format.ts";

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

console.log("joinWithOverflow - readable, capped column-name lists");

check("empty list -> empty string", joinWithOverflow([]) === "");
check("a short list is joined in full, no truncation",
  joinWithOverflow(["Profit", "Sales"]) === "Profit, Sales");
check("exactly at the cap is joined in full, no '+N more' suffix",
  joinWithOverflow(["A", "B", "C"], 3) === "A, B, C");
check("over the cap truncates and appends a '+N more' count",
  joinWithOverflow(["A", "B", "C", "D", "E"], 3) === "A, B, C, +2 more",
  joinWithOverflow(["A", "B", "C", "D", "E"], 3));
check("default cap is 6",
  joinWithOverflow(["A", "B", "C", "D", "E", "F", "G", "H"]) === "A, B, C, D, E, F, +2 more",
  joinWithOverflow(["A", "B", "C", "D", "E", "F", "G", "H"]));

console.log("formatPercent - 0-1 ratios rendered as percentages");
check("a typical margin ratio", formatPercent(0.165) === "16.5%", formatPercent(0.165));
check("a negative ratio keeps its sign", formatPercent(-2.6) === "-260%", formatPercent(-2.6));
check("zero", formatPercent(0) === "0%", formatPercent(0));
check("non-finite input is handled gracefully, not NaN%", formatPercent(NaN) === "—");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
