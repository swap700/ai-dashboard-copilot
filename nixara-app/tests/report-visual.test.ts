/**
 * Regression test for the Mitigation Actions "Role responsible" pill bug.
 *
 * Run with:  npm run test:report-visual
 *
 * BUG: the prompt's example format ("Role responsible: Action — Start
 * within [timeframe].") reads like "Role responsible:" is a literal label
 * to keep, not a placeholder to replace -- and the parser regex only
 * accepted the exact phrase "Start within". A model that echoed the label
 * verbatim, or wrote "Begin within" instead of "Start within", made the
 * whole line fall through to the plain-text fallback: no role pill, while
 * sibling lines that happened to match got one. Confirmed against a real
 * report where exactly this happened on the middle of three action lines.
 */
import { buildVisualSections } from "../lib/report-visual.ts";

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

console.log("Mitigation Actions - role pill survives model wording deviations");

const reportText = `### Mitigation Actions
- Sales Lead: Develop and implement a targeted retention strategy for high-value Technology customers — Start within 1 month.
- Role responsible: Finance Team: Review and tighten discount approval process — Begin within 2 weeks.
- Marketing and Sales Teams: Initiate a Furniture category campaign to boost engagement and sales — Start within 2 months.
`;

const sections = buildVisualSections(reportText, "Risk Report");
const mitigation = sections.find((s) => s.kind === "mitigation");

check("a Mitigation Actions section was found", !!mitigation);
if (mitigation && mitigation.kind === "mitigation") {
  check("all three lines produced an item", mitigation.items.length === 3, `got ${mitigation.items.length}`);

  check("line 1 (clean format) gets its role pill", mitigation.items[0]?.role === "Sales Lead");

  const deviant = mitigation.items[1];
  check("line 2 ('Role responsible:' echo + 'Begin within') still gets a role pill",
    deviant?.role === "Finance Team", JSON.stringify(deviant));
  check("line 2's action body does not retain the redundant 'Role responsible:' prefix",
    !!deviant && !deviant.action.toLowerCase().startsWith("role responsible"), JSON.stringify(deviant));
  check("line 2's timeframe is extracted despite 'Begin within' instead of 'Start within'",
    deviant?.timeframe === "2 weeks", JSON.stringify(deviant));

  check("line 3 (clean format) gets its role pill", mitigation.items[2]?.role === "Marketing and Sales Teams");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
