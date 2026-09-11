/**
 * Regression tests for lib/report.ts's parseRecommendations().
 *
 * Run with:  npm run test:report
 *
 * Covers the bug report (2026-09): "at times when I upload a dataset I don't
 * see recommendations in the Risk Report." Root cause: the Risk Report's own
 * prompt (REPORT_CONFIGS["Risk Report"]) never asked the model to number the
 * risk name line -- only Likelihood/Impact/Signal/Consequence fields plus a
 * mandatory closing "_Strategic Risk_"/"_Operational Risk_" tag. Because
 * parseRecommendations() only ever extracted numbered lines, "Top Risks
 * Identified" produced zero items whenever the model (correctly, per its own
 * instructions) left the risk name unnumbered -- and DecisionPanel hides its
 * whole recommendation picker when recs.length === 0. Fixed by extracting
 * risks from the mandatory tag boundaries instead of numbering, so it works
 * whether or not the model numbers the risk name.
 */

import { parseRecommendations } from "../lib/report.ts";

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

// ── (a) Risk names with NO numbering (exactly what the old prompt asked for,
// and the exact shape that produced zero recommendations before this fix) ──
{
  const report = `### Top Risks Identified
Furniture margin erosion
Likelihood: High
Impact: High
Signal: Furniture profit margin fell to 5.96%, down from an 8% baseline
Consequence: Continued discounting could erase category profitability within two quarters
_Strategic Risk_

Office Supplies fulfillment delay
Likelihood: Medium
Impact: Medium
Signal: Average delivery time in Office Supplies rose to 6.2 days
Consequence: Customer satisfaction scores may decline further
_Operational Risk_

Regional demand concentration
Likelihood: Low
Impact: Medium
Signal: West region generates 42% of total revenue
Consequence: A regional downturn would disproportionately hurt overall sales
_Strategic Risk_

### Early Warning Signs
- Furniture margin trend
- Office Supplies delivery time

### Mitigation Actions
- COO: Cap discounts above 25% -- Start within 1 week.

### Data Quality Risks
Data quality is strong.`;

  const recs = parseRecommendations(report);
  check("(a) unnumbered risk names still produce 3 recommendations", recs.length === 3, JSON.stringify(recs));
  check("(a) first rec carries the risk name and its Signal",
    recs[0] === "1. Furniture margin erosion — Signal: Furniture profit margin fell to 5.96%, down from an 8% baseline",
    recs[0]);
  check("(a) recs are numbered 1-3 in order", recs[1].startsWith("2. Office Supplies fulfillment delay") && recs[2].startsWith("3. Regional demand concentration"), JSON.stringify(recs));
}

// ── (b) Risk names WITH numbering (the reinforced prompt's requested shape) ──
{
  const report = `### Top Risks Identified
1. Furniture margin erosion
Likelihood: High
Impact: High
Signal: Furniture profit margin fell to 5.96%
Consequence: Category profitability at risk
_Strategic Risk_

2. Regional demand concentration
Likelihood: Low
Impact: Medium
Signal: West region generates 42% of total revenue
Consequence: A regional downturn would hurt overall sales
_Strategic Risk_

3. Office Supplies fulfillment delay
Likelihood: Medium
Impact: Medium
Signal: Average delivery time rose to 6.2 days
Consequence: Satisfaction scores may decline
_Operational Risk_`;

  const recs = parseRecommendations(report);
  check("(b) numbered risk names produce 3 recommendations, not double-numbered",
    recs.length === 3 && recs[0] === "1. Furniture margin erosion — Signal: Furniture profit margin fell to 5.96%",
    JSON.stringify(recs));
}

// ── (c) Model omits the closing tag on the last risk -- defensive flush ─────
{
  const report = `### Top Risks Identified
Furniture margin erosion
Likelihood: High
Impact: High
Signal: Furniture profit margin fell to 5.96%
Consequence: Category profitability at risk
_Strategic Risk_

Office Supplies fulfillment delay
Likelihood: Medium
Impact: Medium
Signal: Average delivery time rose to 6.2 days
Consequence: Satisfaction scores may decline`;
  // (no trailing tag, and no following heading either -- end of text)

  const recs = parseRecommendations(report);
  check("(c) a risk block missing its closing tag at end-of-text is still recovered",
    recs.length === 2 && recs[1].startsWith("2. Office Supplies fulfillment delay"), JSON.stringify(recs));
}

// ── (d) Model omits the closing tag but a later heading follows -- still recovered ──
{
  const report = `### Top Risks Identified
Furniture margin erosion
Likelihood: High
Impact: High
Signal: Furniture profit margin fell to 5.96%
Consequence: Category profitability at risk

### Early Warning Signs
- Furniture margin trend`;

  const recs = parseRecommendations(report);
  check("(d) a risk block missing its tag is flushed when the next heading arrives",
    recs.length === 1 && recs[0].startsWith("1. Furniture margin erosion"), JSON.stringify(recs));
}

// ── (e) Other report types are unaffected by the Risk Report changes ───────
{
  const execReport = `### Recommended Actions
1. Cap discounts above 25% to director approval only, effective immediately.
2. Approve a pricing review for the Furniture category within 30 days.
3. Mandate weekly margin reporting to the executive team.`;

  const recs = parseRecommendations(execReport);
  check("(e) Executive Summary's Recommended Actions still extract as-is",
    recs.length === 3 && recs[0] === "1. Cap discounts above 25% to director approval only, effective immediately.",
    JSON.stringify(recs));

  const opsReport = `### Process Recommendations
1. [This week] Review discount approval thresholds -- Sales Manager.
2. [This week] Audit fulfillment delays in Office Supplies -- Ops Lead.
3. [This quarter] Renegotiate Furniture supplier terms -- COO.

### Quick Wins
1. Cap Furniture discounts above 25% -- backed by a 5.96% margin reading.
2. Expedite Office Supplies restocking -- backed by a 6.2-day average delivery time.`;

  const opsRecs = parseRecommendations(opsReport);
  check("(e) Operational Detail's Process Recommendations + Quick Wins still extract correctly",
    opsRecs.length === 5 && opsRecs[3].startsWith("Quick Win 1:") && opsRecs[4].startsWith("Quick Win 2:"),
    JSON.stringify(opsRecs));
}

// ── (f) No risks at all in the section (degenerate/empty report) -> no crash ──
{
  const report = `### Top Risks Identified

### Data Quality Risks
Data quality is strong.`;

  let threw = false;
  let recs: string[] = [];
  try {
    recs = parseRecommendations(report);
  } catch {
    threw = true;
  }
  check("(f) an empty Top Risks Identified section does not throw", !threw);
  check("(f) an empty Top Risks Identified section produces no recommendations", recs.length === 0, JSON.stringify(recs));
}

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
