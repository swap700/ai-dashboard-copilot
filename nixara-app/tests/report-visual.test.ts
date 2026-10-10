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
import { buildVisualSections, listUnverifiedFigures, firstFigure, type VisualSection, exposureShareOf } from "../lib/report-visual.ts";

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


// ── Banner data: which figures are unverified, and where ────────────────────
console.log("\nlistUnverifiedFigures - names the figure and where it is");
{
  const unv = { status: "unverified" } as const;
  const none = { status: "none" } as const;
  const sections: VisualSection[] = [
    {
      kind: "quickWins",
      heading: "Quick Wins",
      items: [
        { stat: "$48,300.00", body: "Recover $48,300.00 by trimming discounts.", evidence: unv },
        { stat: null, body: "Review the 12.50% overlap between regions.", evidence: unv },
        { stat: "5.0%", body: "Raise prices 5.0%.", evidence: none },
      ],
    },
    {
      kind: "topRisks",
      heading: "Top Risks Identified",
      risks: [
        { name: "A", exposure: "28.4% of total billing", exposureEvidence: none, exposureShare: 28.4, type: null, signal: "Margins fell 14.2% last quarter.", consequence: "Loss of $9,000.00", signalEvidence: none, consequenceEvidence: unv },
        { name: "B", exposure: null, exposureEvidence: none, exposureShare: null, type: null, signal: "Returns hit 7.5% of orders.", consequence: "Brand damage", signalEvidence: unv, consequenceEvidence: none },
      ],
    },
  ];
  const listed = listUnverifiedFigures(sections);
  check("every unverified figure is listed, none that were matched", listed.length === 4, JSON.stringify(listed));
  check("a Quick Win with a headline stat uses that stat", listed[0]?.figure === "$48,300.00" && listed[0].where === "Quick Win 1");
  check("a Quick Win without a stat falls back to the first figure in its text", listed[1]?.figure === "12.50%" && listed[1].where === "Quick Win 2");
  check("a risk's consequence is labelled as such", listed[2]?.figure === "$9,000.00" && listed[2].where === "Risk 1, consequence", JSON.stringify(listed[2]));
  check("a risk's signal is labelled as such", listed[3]?.figure === "7.5%" && listed[3].where === "Risk 2, signal", JSON.stringify(listed[3]));
  check("firstFigure picks the first figure in reading order", firstFigure("Fell 14.2% to $9,000.00") === "14.2%");
  check("firstFigure returns null when there is no figure", firstFigure("No numbers here") === null && firstFigure(null) === null);
}

// ── Mitigation Actions: markdown-emphasis-wrapped role names ────────────────
// BUG: the model has been seen wrapping the role name in markdown emphasis
// ("_Finance Team_: Assess...") despite nothing asking it to. That starts
// with "_", not an uppercase letter, so the role regex missed it entirely
// and the raw underscores rendered straight to the reader. Confirmed against
// a real generated report where all three Mitigation Actions lines were
// wrapped this way.
console.log("\nMitigation Actions - a markdown-emphasis-wrapped role name still gets its pill, with the markers stripped");
{
  const reportText = `### Mitigation Actions
_Finance Team_: Assess and diversify contract terms with smaller insurance providers — Start within 2 weeks.
**Accounting Team**: Investigate negative Billing Amount transactions for resolution — Start within 1 week.
`;
  const sections = buildVisualSections(reportText, "Risk Report");
  const mitigation = sections.find((s) => s.kind === "mitigation");
  check("a Mitigation Actions section was found", !!mitigation);
  if (mitigation && mitigation.kind === "mitigation") {
    check("an underscore-wrapped role loses the underscores and still gets its pill",
      mitigation.items[0]?.role === "Finance Team", JSON.stringify(mitigation.items[0]));
    check("the action text carries no leftover underscores",
      !!mitigation.items[0] && !mitigation.items[0].action.includes("_"), JSON.stringify(mitigation.items[0]));
    check("an asterisk-wrapped (bold) role is handled the same way",
      mitigation.items[1]?.role === "Accounting Team", JSON.stringify(mitigation.items[1]));
  }
}

// ── Process Recommendations: stray bracket colon + trailing "Responsible
// Role:" echo ────────────────────────────────────────────────────────────
// BUG: the prompt only said "State the role responsible" with no worked
// example (unlike Mitigation Actions), so the model has been seen doing two
// different things with it in the same real report: writing "[This week]: "
// (treating the bracket itself as the label, leaving a bare leading ": "
// once the bracket is stripped), and echoing "Responsible Role: X." onto the
// END of the sentence instead of leading with "X: ". Both left Nixara's own
// scaffolding in the text the reader saw, with no role pill either.
console.log("\nProcess Recommendations - a stray bracket colon and a trailing 'Responsible Role:' echo both resolve to a clean role pill");
{
  const reportText = `### Process Recommendations
1. [This week] : Dispatch an audit on billing practices for Diabetes cases to identify cost-saving opportunities. Responsible Role: Billing Manager.
2. [This quarter] Operations Director: Develop and implement a streamlined billing review process.
`;
  const sections = buildVisualSections(reportText, "Operational Detail");
  const processRec = sections.find((s) => s.kind === "processRec");
  check("a Process Recommendations section was found", !!processRec);
  if (processRec && processRec.kind === "processRec") {
    const first = processRec.items[0];
    check("a trailing 'Responsible Role:' echo is recovered into the role field",
      first?.role === "Billing Manager", JSON.stringify(first));
    check("the stray leading colon from '[This week]: ' is gone from the body",
      !!first && !first.body.startsWith(":"), JSON.stringify(first));
    check("the body still ends as a clean sentence",
      first?.body === "Dispatch an audit on billing practices for Diabetes cases to identify cost-saving opportunities.",
      JSON.stringify(first));
    check("a normally-formatted leading role (the already-correct case) is unaffected",
      processRec.items[1]?.role === "Operations Director", JSON.stringify(processRec.items[1]));
  }
}

// ── Efficiency Gaps: a mid-sentence "Inferred:" still gets its badge ────────
// BUG: the prompt only said to "prefix" an inference with "Inferred:", not
// to put it on its own line, so a direct finding and an inference have been
// seen landing in the same run-on sentence. The badge detection only ever
// matched "Inferred:" at the very start of a line, so the literal word
// rendered as plain prose instead of a badge. Confirmed against a real
// report.
console.log("\nEfficiency Gaps - a mid-sentence 'Inferred:' is split into its own badged line");
{
  const reportText = `### Efficiency Gaps
Efficiency gaps appear in medical conditions where the Billing Amount for Obesity and Diabetes is relatively high. Inferred: reviewing billing efficiencies in these categories could uncover potential cost-saving opportunities.
`;
  const sections = buildVisualSections(reportText, "Operational Detail");
  const gaps = sections.find((s) => s.kind === "efficiencyGaps");
  check("an Efficiency Gaps section was found", !!gaps);
  if (gaps && gaps.kind === "efficiencyGaps") {
    check("the run-on sentence became two separate lines", gaps.lines.length === 2, JSON.stringify(gaps.lines));
    check("the direct finding is not marked inferred",
      gaps.lines[0]?.inferred === false && !gaps.lines[0].text.includes("Inferred"), JSON.stringify(gaps.lines[0]));
    check("the inferred half is marked inferred, with the label stripped from the text",
      gaps.lines[1]?.inferred === true && !gaps.lines[1].text.includes("Inferred"), JSON.stringify(gaps.lines[1]));
  }
}


// ── A date is not a figure ──────────────────────────────────────────────────
// The bare-decimal branch used \b boundaries, so "31.03" was pulled out of
// "31.03.2025" and the report carried an unverified-figure warning about a
// number that was never a number. European dates are the common case.
{
  const cases: [string, string | null][] = [
    ["Signed on 31.03.2025 the deal closed", null],
    ["On 2025-03-31 we closed", null],
    ["Version 1.2.3 shipped", null],
    ["Margin fell to 1,234.56 last quarter", "1,234.56"],
    ["Loss of $9,000.00", "$9,000.00"],
    ["Up 14.2%", "14.2%"],
    ["Rate 0.55 per unit", "0.55"],
  ];
  for (const [text, expected] of cases) {
    check(`firstFigure(${JSON.stringify(text)}) is ${JSON.stringify(expected)}`,
      firstFigure(text) === expected, JSON.stringify(firstFigure(text)));
  }
}


// ── The exposure bar needs a number it can draw ─────────────────────────────
// The bar is the only visual on a risk card. It was drawn from a percentage
// found in the Exposure text, so whenever the model chose to write an
// absolute amount instead the bar silently did not appear. An amount is now
// divided by the matching total Nixara itself computed.
{
  const facts = [
    { value: 1417432042, isPercent: false, description: "Total Billing Amount across 55500 rows" },
    { value: 25539.32, isPercent: false, description: "Average Billing Amount across 55500 rows" },
  ];
  check("a percentage is taken as written",
    exposureShareOf("20.3% of total Billing Amount", facts) === 20.3,
    String(exposureShareOf("20.3% of total Billing Amount", facts)));
  check("a magnitude amount is divided by the matching total", (() => {
    const share = exposureShareOf("$290 million of total Billing Amount", facts);
    return share !== null && Math.abs(share - 20.46) < 0.1;
  })(), String(exposureShareOf("$290 million of total Billing Amount", facts)));
  check("a plain amount works too", (() => {
    const share = exposureShareOf("$141,743,204.00 of Billing Amount", facts);
    return share !== null && Math.abs(share - 10) < 0.1;
  })(), String(exposureShareOf("$141,743,204.00 of Billing Amount", facts)));
  check("an average is never used as the denominator",
    exposureShareOf("$290 million of average Billing", [facts[1]]) === null);
  check("an amount with no matching total gives null, not a wrong bar",
    exposureShareOf("$290 million of total Headcount", facts) === null);
  check("a share over 100% is refused rather than drawn off the end",
    exposureShareOf("$3 billion of total Billing Amount", facts) === null);
  check("text with no figure at all gives null",
    exposureShareOf("most of the book of business", facts) === null);
}


// ── A risk that leads with Exposure must not lose it ───────────────────────
// Seen in production the day Exposure shipped: the model skipped the name
// line and began every risk with "Exposure: ...". The parser only accepted a
// labelled field when a risk was already open, so the line fell through to
// the name branch. Every card rendered the exposure sentence as its title
// with no bar and no evidence tag.
{
  const report = [
    "### Top Risks Identified",
    "Exposure: 0.9% of the total Billing Amount, equating to $13,363,704.00 comes from 534 exact repeat rows.",
    "Signal: The presence of duplicate rows indicates potential overstatement of revenue.",
    "Consequence: Inaccurate financial reporting.",
    "_Operational Risk_",
  ].join("\n");
  const sections = buildVisualSections(report, "Risk Report", []);
  const risks = sections.find((s) => s.kind === "topRisks");
  const card = risks && risks.kind === "topRisks" ? risks.risks[0] : null;
  check("the exposure is captured even with no name line above it",
    card !== null && card.exposure !== null && card.exposure.startsWith("0.9%"),
    JSON.stringify(card?.exposure));
  check("the signal and consequence still land",
    card !== null && card.signal !== null && card.consequence !== null);
  check("the type tag still closes the risk",
    card !== null && card.type === "Operational Risk");
  check("and the bar has a share to draw",
    card !== null && card.exposureShare !== null && Math.abs(card.exposureShare - 0.9) < 0.01,
    String(card?.exposureShare));
  check("the headline falls back to the exposure rather than the word Risk",
    card !== null && card.name === card.exposure);
}

// A rate of change is not an exposure, and must not draw a bar.
{
  const facts = [{ value: 1417432042, isPercent: false, description: "Total Billing Amount across 55500 rows" }];
  check("a signed change percentage draws no bar",
    exposureShareOf("The total Billing Amount is rising from $17.6m to $23.5m (+33.2%).", facts) === null,
    String(exposureShareOf("The total Billing Amount is rising from $17.6m to $23.5m (+33.2%).", facts)));
  check("a percentage with nothing to be a share OF draws no bar",
    exposureShareOf("Costs rose 33.2% over the period.", facts) === null,
    String(exposureShareOf("Costs rose 33.2% over the period.", facts)));
  check("a genuine share still draws",
    exposureShareOf("20.3% of total Billing Amount", facts) === 20.3);
  check("the 'of ... %' word order also draws",
    exposureShareOf("of total Billing Amount, 12.5% sits with one insurer", facts) === 12.5,
    String(exposureShareOf("of total Billing Amount, 12.5% sits with one insurer", facts)));
  check("a percentage that names nothing it is a share of is refused, by design",
    exposureShareOf("accounts for a 12.5% slice", facts) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
