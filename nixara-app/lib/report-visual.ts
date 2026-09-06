/**
 * Presentation-only layer on top of parseReportLines(). Deliberately does NOT
 * modify parseReportLines or the ReportLine type — those are also consumed by
 * the docx/pdf export routes and parseRecommendations(), and changing their
 * output shape would risk breaking exports that have nothing to do with the
 * on-screen redesign. This file only re-groups/re-classifies the *existing*
 * lines for ReportTabs' benefit.
 *
 * Every parser here is built against the EXACT format rules enforced in the
 * REPORT_CONFIGS prompts (report.ts) — e.g. "Likelihood: High/Medium/Low" is
 * a guaranteed literal prefix, not a guess. Where the prompt doesn't force an
 * exact format (e.g. Process Recommendations' "state the role responsible"
 * has no mandated syntax), the parser degrades gracefully: if the pattern
 * isn't found, the content still renders as plain text rather than being
 * dropped or crashing. Nothing here should ever cause a report to fail to
 * render — worst case, a section falls back to the old plain-paragraph look.
 */

import { parseReportLines, type ReportLine, type ReportType } from "./report";
import { findEvidence, type EvidenceFact } from "./evidence";

export type Severity = "low" | "medium" | "high";

export interface ActionItem {
  verb: "Decide" | "Restrict" | "Approve" | "Mandate" | null;
  body: string;
}

export interface RiskWaitItem {
  text: string;
}

export interface ProcessItem {
  timeframe: string | null; // e.g. "This week" / "This quarter", raw bracket text otherwise
  role: string | null;
  body: string;
}

export interface QuickWinItem {
  stat: string | null; // e.g. "34%" or "$1,234.56"
  body: string;
  /** Evidence Trail: where `stat` came from in the uploaded dataset, if a match was found. */
  evidence: EvidenceFact | null;
}

export interface RiskCard {
  name: string;
  likelihood: Severity;
  impact: Severity;
  signal: string | null;
  consequence: string | null;
  type: "Strategic Risk" | "Operational Risk" | null;
  /** Evidence Trail: source for the number cited in `signal` / `consequence`, if a match was found. */
  signalEvidence: EvidenceFact | null;
  consequenceEvidence: EvidenceFact | null;
}

export interface MitigationItem {
  role: string | null;
  action: string;
  timeframe: string | null;
}

export type VisualSection =
  | { kind: "prose"; heading: string; lines: string[] }
  | { kind: "actions"; heading: string; items: ActionItem[] }
  | { kind: "riskWait"; heading: string; items: RiskWaitItem[] }
  | { kind: "efficiencyGaps"; heading: string; lines: { text: string; inferred: boolean }[] }
  | { kind: "processRec"; heading: string; items: ProcessItem[] }
  | { kind: "quickWins"; heading: string; items: QuickWinItem[] }
  | { kind: "topRisks"; heading: string; risks: RiskCard[] }
  | { kind: "earlyWarning"; heading: string; items: string[] }
  | { kind: "mitigation"; heading: string; items: MitigationItem[] }
  | { kind: "dataQuality"; heading: string; text: string; score: number | null };

const SEVERITY_MAP: Record<string, Severity> = { high: "high", medium: "medium", low: "low" };

function parseSeverity(raw: string | undefined): Severity {
  if (!raw) return "medium";
  const key = raw.trim().toLowerCase();
  if (SEVERITY_MAP[key]) return SEVERITY_MAP[key];
  // Prompt only allows exact High/Medium/Low, but if the model deviates
  // (e.g. "Very High"), match by substring rather than silently downgrading
  // to Medium — understating a stated severity is the worse failure mode
  // for a risk display. Check "high" first so "Medium-High" reads as High.
  if (key.includes("high")) return "high";
  if (key.includes("low")) return "low";
  if (key.includes("medium")) return "medium";
  return "medium";
}

function stripNumberPrefix(text: string): string {
  return text.replace(/^\d+\.\s*/, "");
}

/**
 * Returns the raw text of a line regardless of its kind (numbered/bullet/text).
 *
 * BUG FIX (2026-08): Quick Wins, Early Warning Signs, and Mitigation Actions
 * were originally parsed by filtering for kind === "numbered" only. That
 * assumption doesn't hold: unlike Recommended Actions ("EXACTLY 3 numbered
 * actions") and Process Recommendations (which shows an explicit "1. [This
 * week]..." template), the prompt text for these three sections never
 * actually mandates a numbered list -- it only describes the expected count
 * and content in prose. A model that complies with the prompt can still
 * emit these as plain sentences, and the numbered-only filter was silently
 * dropping that content entirely (confirmed against a real generated report
 * where Mitigation Actions rendered as an empty card). Accepting any
 * non-blank line kind here fixes that without assuming a format the prompt
 * never actually promised.
 */
function anyLineText(l: ReportLine): string | null {
  if (l.kind === "numbered") return stripNumberPrefix(l.text);
  if (l.kind === "bullet" || l.kind === "text") return l.text;
  return null;
}

/** Best-effort "Role Name: rest of sentence" extraction — degrades to null if not found. */
function extractLeadingRole(text: string): { role: string | null; rest: string } {
  const m = /^([A-Z][A-Za-z/&\- ]{2,40}):\s*(.+)$/.exec(text.trim());
  if (m) return { role: m[1].trim(), rest: m[2].trim() };
  return { role: null, rest: text.trim() };
}

function extractFirstStat(text: string): string | null {
  const m = /\$[\d,]+\.\d{2}|\d+(?:\.\d+)?%/.exec(text);
  return m ? m[0] : null;
}

const ACTION_VERBS = ["Decide", "Restrict", "Approve", "Mandate"] as const;

function parseActionVerb(text: string): ActionItem["verb"] {
  for (const verb of ACTION_VERBS) {
    if (new RegExp(`^${verb}\\b`, "i").test(text.trim())) return verb;
  }
  return null;
}

/**
 * Groups the flat ReportLine[] stream into per-heading buckets, then applies
 * a section-specific parser to each bucket based on which report type and
 * heading it is. Unrecognized headings fall back to plain prose so nothing
 * is ever silently dropped.
 */
export function buildVisualSections(
  reportText: string,
  reportType: ReportType,
  evidenceFacts: EvidenceFact[] = []
): VisualSection[] {
  const lines = parseReportLines(reportText);
  const buckets: { heading: string; lines: ReportLine[] }[] = [];
  let current: { heading: string; lines: ReportLine[] } | null = null;

  for (const line of lines) {
    if (line.kind === "heading") {
      current = { heading: line.text, lines: [] };
      buckets.push(current);
      continue;
    }
    if (line.kind === "blank" || !current) continue;
    current.lines.push(line);
  }

  return buckets.map(({ heading, lines }) => parseSection(heading, lines, reportType, evidenceFacts));
}

function parseSection(heading: string, lines: ReportLine[], reportType: ReportType, evidenceFacts: EvidenceFact[]): VisualSection {
  switch (heading) {
    case "Recommended Actions":
      return {
        kind: "actions",
        heading,
        items: lines
          .filter((l): l is Extract<ReportLine, { kind: "numbered" }> => l.kind === "numbered")
          .map((l) => {
            const body = stripNumberPrefix(l.text);
            return { verb: parseActionVerb(body), body };
          }),
      };

    case "Risks If You Wait":
      return {
        kind: "riskWait",
        heading,
        items: lines
          .filter((l): l is Extract<ReportLine, { kind: "bullet" }> => l.kind === "bullet")
          .map((l) => ({ text: l.text })),
      };

    case "Efficiency Gaps":
      return {
        kind: "efficiencyGaps",
        heading,
        lines: lines
          .filter((l): l is Extract<ReportLine, { kind: "text" }> => l.kind === "text")
          .map((l) => {
            const inferred = /^Inferred:\s*/i.test(l.text);
            return { text: l.text.replace(/^Inferred:\s*/i, ""), inferred };
          }),
      };

    case "Process Recommendations":
      return {
        kind: "processRec",
        heading,
        items: lines
          .filter((l): l is Extract<ReportLine, { kind: "numbered" }> => l.kind === "numbered")
          .map((l) => {
            const body = stripNumberPrefix(l.text);
            const bracketMatch = /^\[([^\]]+)\]\s*(.*)$/.exec(body);
            const timeframe = bracketMatch ? bracketMatch[1].trim() : null;
            const rest = bracketMatch ? bracketMatch[2] : body;
            const { role, rest: cleanBody } = extractLeadingRole(rest);
            return { timeframe, role, body: cleanBody };
          }),
      };

    case "Quick Wins":
      return {
        kind: "quickWins",
        heading,
        items: lines
          .map(anyLineText)
          .filter((t): t is string => t !== null)
          .map((body) => {
            const stat = extractFirstStat(body);
            return { stat, body, evidence: stat ? findEvidence(stat, evidenceFacts) : null };
          }),
      };

    case "Top Risks Identified": {
      const risks: RiskCard[] = [];
      let cur: Partial<RiskCard> | null = null;

      const flush = (c: Partial<RiskCard>) => {
        risks.push({
          name: c.name ?? "Risk",
          likelihood: c.likelihood ?? "medium",
          impact: c.impact ?? "medium",
          signal: c.signal ?? null,
          consequence: c.consequence ?? null,
          type: c.type ?? null,
          signalEvidence: c.signal ? findEvidence(c.signal, evidenceFacts) : null,
          consequenceEvidence: c.consequence ? findEvidence(c.consequence, evidenceFacts) : null,
        });
      };

      for (const l of lines) {
        if (l.kind === "tag") {
          if (cur) {
            const t = l.text.trim();
            cur.type = t === "Strategic Risk" || t === "Operational Risk" ? (t as RiskCard["type"]) : null;
            flush(cur);
            cur = null;
          }
          continue;
        }
        if (l.kind !== "text") continue;
        const likelihoodM = /^Likelihood:\s*(.*)$/i.exec(l.text);
        const impactM = /^Impact:\s*(.*)$/i.exec(l.text);
        const signalM = /^Signal:\s*(.*)$/i.exec(l.text);
        const consequenceM = /^Consequence:\s*(.*)$/i.exec(l.text);

        if (likelihoodM && cur) { cur.likelihood = parseSeverity(likelihoodM[1]); continue; }
        if (impactM && cur) { cur.impact = parseSeverity(impactM[1]); continue; }
        if (signalM && cur) { cur.signal = signalM[1].trim(); continue; }
        if (consequenceM && cur) { cur.consequence = consequenceM[1].trim(); continue; }

        // Not a labeled field -> this is a new risk's name line.
        // Flush an unterminated previous risk defensively (missing tag line).
        if (cur) flush(cur);
        cur = { name: l.text.trim() };
      }
      if (cur) flush(cur);

      return { kind: "topRisks", heading, risks };
    }

    case "Early Warning Signs":
      return {
        kind: "earlyWarning",
        heading,
        items: lines.map(anyLineText).filter((t): t is string => t !== null),
      };

    case "Mitigation Actions":
      return {
        kind: "mitigation",
        heading,
        items: lines
          .map(anyLineText)
          .filter((t): t is string => t !== null)
          .map((body) => {
            const m = /^([A-Z][A-Za-z/&\- ]{2,40}):\s*(.+?)\s*[-–—]\s*Start within\s*(.+?)\.?\s*$/i.exec(body);
            if (m) return { role: m[1].trim(), action: m[2].trim(), timeframe: m[3].trim() };
            return { role: null, action: body, timeframe: null };
          }),
      };

    case "Data Quality Risks": {
      const text = lines.map(anyLineText).filter((t): t is string => t !== null).join(" ");
      const scoreM = /score:\s*(\d+)\s*\/\s*100/i.exec(text);
      return { kind: "dataQuality", heading, text, score: scoreM ? parseInt(scoreM[1], 10) : null };
    }

    default:
      return {
        kind: "prose",
        heading,
        lines: lines.map((l) => (l.kind === "text" ? l.text : l.kind === "bullet" ? `• ${l.text}` : l.kind === "numbered" ? l.text : "")).filter(Boolean),
      };
  }
}
