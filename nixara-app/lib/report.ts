/**
 * Faithful port of REPORT_CONFIGS / generate_report / clean_ai_output
 * from dashboard_ai_app.py (lines 798-893).
 */

export type ReportType = "Executive Summary" | "Operational Detail" | "Risk Report";

export const REPORT_TYPES: ReportType[] = [
  "Executive Summary",
  "Operational Detail",
  "Risk Report",
];

export const REPORT_CONFIGS: Record<ReportType, string> = {

  "Executive Summary": `Structure your response EXACTLY as:

Situation
(2-3 sentences stating the headline finding in plain business English. No jargon, no technical terms.)

What This Means For You
(Connect directly to the decision and role — 2-3 sentences written at board level.)

Recommended Actions
(EXACTLY 3 numbered actions. Every action must be a DIRECTIVE — a decision, a policy change, or an approval to grant or withhold. NOT an analytical task.

BANNED phrases in this section: "Analyze", "Conduct a review", "Investigate", "Consider", "Monitor", "Explore", "Assess", "Evaluate".
BANNED words anywhere in this report: "correlation", "z-score", "regression", "coefficient", "statistical", "outlier", "anomaly".
BANNED FABRICATIONS: Never state specific percentages, growth rates, or dollar projections that cannot be directly calculated from the data summary provided. Do not write "profitability may decrease by 10%" or "sales could grow by 8%" — these numbers cannot be verified and will destroy credibility with finance-trained readers. Instead use directional language: "profitability is on a declining trajectory" or "Technology margins are compressing." Honest uncertainty is more credible than invented precision.

Each action format: "[Decide / Restrict / Approve / Mandate] [what specifically] [by when]."
Example of correct action: "Cap discounts above 25% to director approval only, effective immediately."
Example of wrong action: "Analyze discount patterns across sub-categories." ← Never write this.)

Risks If You Wait
(EXACTLY 2 bullet points — what gets measurably worse if no action is taken this quarter. Use numbers from the data.)

Rules: under 350 words. Write to prompt a decision, not a meeting. Every action must be something an executive can sign off on today.`,

  "Operational Detail": `Structure your response EXACTLY as:

Performance Breakdown
(By the main dimensions in the data — categories, regions, segments, product lines. Reference specific numbers for every claim.)

Efficiency Gaps
(Where effort or cost is not matching return.
CRITICAL RULE: Only make claims that are DIRECTLY SUPPORTED by the data provided. If a recommendation is a logical inference rather than a direct finding, you MUST prefix it with "Inferred:" so the reader knows the evidence basis.
Do not present inferences as facts.)

Process Recommendations
(EXACTLY 3 numbered recommendations — no more, no fewer. Forced priority ranking:
1. [This week] — one action completable in 7 days. State the role responsible.
2. [This week] — one action completable in 7 days. State the role responsible.
3. [This quarter] — one strategic change for the quarter. State the role responsible.
Label each item with its timeframe in brackets.)

Quick Wins
(EXACTLY 2 items doable in the next 2 weeks with zero new budget. Each must cite a specific number from the data as the justification.)

Rules: under 500 words. Operational language. Every point references data. The total action items across all sections must not exceed 5.`,

  "Risk Report": `Structure your response EXACTLY as:

Top Risks Identified
(EXACTLY 3 risks. For EACH risk use this format:
Risk name
Likelihood: High / Medium / Low
Impact: High / Medium / Low
Signal: [the specific metric or number from the data that flags this]
Consequence: [what happens if unaddressed, with a number]

Rank from highest to lowest combined risk level. Explicitly differentiate: operational risks (fixable this week) vs strategic risks (require quarterly attention).

CRITICAL RULES for risk identification:
— A large number of customers in one category is NOT concentration risk — that is distribution breadth, which is positive. Concentration risk only applies when a small number of CUSTOMERS generate a disproportionate share of REVENUE (e.g. top 5 customers = 70% of sales). Never flag healthy distribution as a risk.
— Do not flag things that are performing well as risks.
— Separate operational risks from strategic risks explicitly.
— Likelihood must describe a FUTURE event, not a current state. If something is already true (e.g. margins are already low), the risk is that it worsens — not that it exists. Rephrase as: "Likelihood of further margin deterioration: High, given no current pricing intervention." Never assign Likelihood: High to something that is already a present fact.
— NEVER invent dollar amounts. Any specific dollar figure in this report must come directly from the data summary. If no specific amount is computable from the data, use directional language instead — "significant profit erosion" not "$8,000 at risk." Fabricated dollar figures are worse than no figures at all.)

Early Warning Signs
(3-4 specific metrics to monitor as leading indicators. Include threshold values where the data supports them.)

Mitigation Actions
(One concrete action per risk. Format: "Role responsible: Action — Start within [timeframe].")

Data Quality Risks
(Apply this rule strictly:
— If the data quality score is above 90/100 AND detected anomalies are explainable as normal business variation (seasonality, promotions, pricing tiers), write: "Data quality is strong (score: [X]/100). Detected outliers in [field] reflect business patterns — treat as signals, not data errors."
— Only flag genuine data integrity problems: missing values in critical fields, impossible values, duplicates that distort totals, or conflicting summary statistics.
— NEVER say data quality is both high AND a risk in the same report. Pick one position and defend it.)

Rules: under 500 words. Risk language. Every claim references a specific number. Never present operational fixes and strategic concerns at the same severity level.`,
};

export interface PromptParams {
  who: string;
  decision: string;
  timeframe: string;
  reportType: ReportType;
  summary: string;
}

/** Mirrors the f-string prompt built in generate_report. */
export function buildPrompt({ who, decision, timeframe, reportType, summary }: PromptParams): string {
  const instruction = REPORT_CONFIGS[reportType];
  return `You are advising a ${who} who needs to make a decision about:
"${decision}"

Time horizon: ${timeframe}
Report type: ${reportType}

${instruction}

Currency formatting rule (applies everywhere in this report): write every currency value as "$" followed by the number with exactly two decimal places, e.g. $12,345.67. Never wrap numbers in parentheses or brackets. Write negative values with a minus sign directly before the dollar sign — e.g. -$12,345.67 — never $-12,345.67 or ($12,345.67).

Write for a ${who} — direct and specific, not academic.

Dashboard data:
${summary}
`;
}

const SECTION_HEADERS = [
  "Situation", "What This Means For You", "Recommended Actions",
  "Risks If You Wait", "Performance Breakdown", "Efficiency Gaps",
  "Process Recommendations", "Quick Wins", "Top Risks Identified",
  "Early Warning Signs", "Mitigation Actions", "Data Quality Risks",
];

/**
 * Rounds a numeric string to exactly two decimal places and (re)applies
 * thousands-separator commas, regardless of whether the source had them.
 */
function formatTwoDecimals(numStr: string): string {
  const value = parseFloat(numStr.replace(/,/g, ""));
  if (Number.isNaN(value)) return numStr;
  const [intPart, decPart] = value.toFixed(2).split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${withCommas}.${decPart}`;
}

/**
 * Normalizes every currency figure in the report text to a single consistent
 * format: "$" + number with exactly two decimal places, no thousands-parentheses,
 * and negative values written with a minus sign BEFORE the dollar sign
 * (e.g. -$12,345.67). This is a deterministic safety net — the prompt also asks
 * the model to follow this format, but LLM output isn't 100% reliable, so we
 * enforce it here regardless of what the model actually returned.
 */
function normalizeCurrency(text: string): string {
  let out = text;

  // 1. Parenthesized amounts (accounting-style negatives), e.g. "($1,234.5)",
  //    "(1,234.50)", "($-1,234)" → "-$1,234.50"
  out = out.replace(
    /\(\s*-?\$?\s*([\d,]+(?:\.\d+)?)\s*\)/g,
    (_m, num: string) => `-$${formatTwoDecimals(num)}`
  );

  // 2. "$-1,234.5" (dollar sign before the minus) → "-$1,234.50"
  out = out.replace(
    /\$-\s*([\d,]+(?:\.\d+)?)/g,
    (_m, num: string) => `-$${formatTwoDecimals(num)}`
  );

  // 3. Any remaining "$" amount (optionally already minus-prefixed) →
  //    enforce exactly two decimal places, e.g. "$1,234" → "$1,234.00",
  //    "-$1,234.5" → "-$1,234.50", "$1,234.567" → "$1,234.57" (rounded)
  out = out.replace(
    /(-?)\$([\d,]+(?:\.\d+)?)/g,
    (_m, sign: string, num: string) => `${sign}$${formatTwoDecimals(num)}`
  );

  return out;
}

/** Mirrors clean_ai_output: normalizes the AI's markdown into consistent "### Header" sections. */
export function cleanAiOutput(raw: string): string {
  let text = raw;
  text = text.replace(/\*\*/g, "");
  text = text.replace(/^#{1,6}\s*/gm, "");
  text = text.replace(/`([^`]*)`/g, "$1");
  for (const h of SECTION_HEADERS) {
    const re = new RegExp(h, "gi");
    text = text.replace(re, `\n### ${h}`);
  }
  text = normalizeCurrency(text);
  return text.trim();
}

export type ReportLine =
  | { kind: "blank" }
  | { kind: "heading"; text: string }
  | { kind: "numbered"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "tag"; text: string }
  | { kind: "text"; text: string };

/**
 * Sections whose numbered items are the primary decision/action options.
 * Items here appear as-is: "1. [This week] …"
 */
const PRIMARY_ACTION_SECTIONS = new Set([
  "Recommended Actions",   // Executive Summary
  "Process Recommendations", // Operational Detail
  "Top Risks Identified",  // Risk Report
]);

/**
 * Sections whose numbered items are secondary — displayed with a clear prefix
 * so they don't collide with the primary 1/2/3 numbering.
 * e.g. "Quick Win 1: …" instead of a bare "1. …"
 */
const SECONDARY_SECTION_LABEL: Record<string, string> = {
  "Quick Wins": "Quick Win",
  "Mitigation Actions": "Mitigation",
  "Early Warning Signs": "Signal",
};

/**
 * Extracts numbered recommendations/actions from a cleaned report.
 * Tracks the current section heading so Quick Wins (1, 2) are prefixed as
 * "Quick Win 1: …" rather than appearing as bare "1. …" alongside the primary
 * Process Recommendations (1, 2, 3) — which caused duplicate numbering in the UI.
 */
export function parseRecommendations(reportText: string): string[] {
  const lines = parseReportLines(reportText);
  const results: string[] = [];
  let currentSection = "";

  for (const line of lines) {
    if (line.kind === "heading") {
      currentSection = line.text;
      continue;
    }
    if (line.kind !== "numbered") continue;

    if (PRIMARY_ACTION_SECTIONS.has(currentSection)) {
      // Primary action — show as-is
      results.push(line.text);
    } else {
      const label = SECONDARY_SECTION_LABEL[currentSection];
      if (label) {
        // Re-label: "Quick Win 1: [body]" instead of "1. [body]"
        const m = line.text.match(/^(\d+)\.\s*([\s\S]*)/);
        results.push(m ? `${label} ${m[1]}: ${m[2]}` : `${label}: ${line.text}`);
      }
      // Numbered items in unrecognised sections are skipped
    }
  }

  return results.slice(0, 10);
}

/** Splits cleaned report text into structured lines for rendering or document export. */
export function parseReportLines(reportText: string): ReportLine[] {
  // Mirrors the render-time fix-up: ensure a blank line precedes every "### " header.
  const withSpacing = reportText.replace(/([^\n])\n(### )/g, "$1\n\n$2");

  return withSpacing.split("\n").map((raw) => {
    const line = raw.trim();
    if (!line) return { kind: "blank" };
    if (line.startsWith("### ")) return { kind: "heading", text: line.slice(4) };
    if (/^\d+\./.test(line)) return { kind: "numbered", text: line };
    if (line.startsWith("- ") || line.startsWith("• ")) return { kind: "bullet", text: line.slice(2) };
    // Standalone markdown-italic label, e.g. "_Strategic Risk_" or "_Operational Risk_" —
    // the AI emits these as its own line to differentiate risk types (see Risk Report
    // prompt rules). Render as a tag/badge instead of printing the raw underscores.
    const tagMatch = /^_([^_\n]+)_$/.exec(line);
    if (tagMatch) return { kind: "tag", text: tagMatch[1].trim() };
    return { kind: "text", text: line };
  });
}
