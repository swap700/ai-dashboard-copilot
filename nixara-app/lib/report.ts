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
(2-3 sentences on what the data shows at the highest level)

What This Means For You
(connect to the decision and role — 2-3 sentences)

Recommended Actions
(3 numbered actions, each specific and time-bound)

Risks If You Wait
(2 bullet points on what gets worse without action)

Rules: under 350 words, every action references a number, never say consider monitoring.`,

  "Operational Detail": `Structure your response EXACTLY as:

Performance Breakdown
(by the main dimensions in the data — categories, regions, segments, etc.)

Efficiency Gaps
(where effort or cost is not matching return — specific numbers)

Process Recommendations
(4-5 numbered operational changes implementable this quarter)

Quick Wins
(2 things doable in the next 2 weeks with zero new resources)

Rules: under 500 words, operational language, every point references data.`,

  "Risk Report": `Structure your response EXACTLY as:

Top Risks Identified
(3 risks ranked by severity — each with: what it is, what signals it, potential impact)

Early Warning Signs
(specific metrics to watch as leading indicators)

Mitigation Actions
(one concrete action per risk — specific, assignable, time-bound)

Data Quality Risks
(flag any gaps, anomalies, or quality issues masking bigger problems)

Rules: under 450 words, risk language, reference specific numbers, write to prompt escalation.`,
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
