/**
 * Regression test for lib/format.ts's display helpers.
 *
 * Run with:  npm run test:format
 */
import { joinWithOverflow, formatPercent, formatNumber } from "../lib/format.ts";

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


// ── Small numbers must survive being formatted ──────────────────────────────
// A conversion rate of 0.0012 rendered as "0", so the anomaly banner read
// "Conversion Rate as low as 0" -- a figure not in the data, and one that
// reads as a broken column rather than a small number.
console.log("formatNumber - a small rate is not zero");

check("0.0012 keeps its digits", formatNumber(0.0012) === "0.0012", formatNumber(0.0012));
check("0.00000456 keeps three significant figures",
  formatNumber(0.00000456) === "0.00000456", formatNumber(0.00000456));
check("0.005 is not doubled to 0.01", formatNumber(0.005) === "0.005", formatNumber(0.005));
check("zero is still zero", formatNumber(0) === "0", formatNumber(0));
check("a negative small number keeps its sign",
  formatNumber(-0.0012) === "-0.0012", formatNumber(-0.0012));
check("money is still two decimals with separators",
  formatNumber(1234.5678) === "1,234.57", formatNumber(1234.5678));
check("an ordinary fraction is unchanged", formatNumber(0.5) === "0.5", formatNumber(0.5));
check("no floating-point tail leaks through",
  !formatNumber(0.0001 + 0.0002).includes("0000000"), formatNumber(0.0001 + 0.0002));
check("a tiny percentage is readable",
  formatPercent(0.000012) === "0.0012%", formatPercent(0.000012));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
