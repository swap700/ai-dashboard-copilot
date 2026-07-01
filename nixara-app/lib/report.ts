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
— Separate operational risks from strategic risks explicitly.)

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
  return text.trim();
}

export type ReportLine =
  | { kind: "blank" }
  | { kind: "heading"; text: string }
  | { kind: "numbered"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "text"; text: string };

/**
 * Extracts numbered recommendations/actions from a cleaned report.
 * Returns the full "1. Some action…" strings so they can be shown as selectable options.
 */
export function parseRecommendations(reportText: string): string[] {
  return parseReportLines(reportText)
    .filter((l): l is { kind: "numbered"; text: string } => l.kind === "numbered")
    .map((l) => l.text)
    .slice(0, 8); // safety cap
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
    return { kind: "text", text: line };
  });
}
