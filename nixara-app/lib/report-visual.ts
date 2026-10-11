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
import { findEvidence, type EvidenceFact, type EvidenceResult } from "./evidence";
import type { ColumnIssue, UnmeasuredColumn } from "./data-analysis";


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
  /** Evidence Trail: whether `stat` traces to something real in the uploaded dataset. */
  evidence: EvidenceResult;
}

export interface RiskCard {
  name: string;
  /**
   * The share of something this risk puts at stake, copied from a figure
   * Nixara computed. This replaced a Likelihood/Impact pair of High/Medium/Low
   * ratings: nothing in a single file supports a probability of a future
   * event, so the model was inventing both words and a 3x3 matrix was drawn
   * from them. A share of a total is a number the file actually contains.
   */
  exposure: string | null;
  exposureEvidence: EvidenceResult;
  /**
   * The exposure as a share of the whole, 0 to 100, for the bar beside it.
   *
   * Taken from a percentage in the text where there is one. Where the model
   * wrote an absolute amount instead ("$290 million of total billing"), it is
   * computed against the matching "Total X" figure Nixara itself produced, so
   * the bar still draws. Null only when neither is available, and then the
   * Exposure line renders on its own rather than the card looking broken.
   */
  exposureShare: number | null;
  signal: string | null;
  consequence: string | null;
  type: "Strategic Risk" | "Operational Risk" | null;
  /** Evidence Trail: whether the number cited in `signal` / `consequence` traces to something real. */
  signalEvidence: EvidenceResult;
  consequenceEvidence: EvidenceResult;
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
  | {
      kind: "dataQuality";
      heading: string;
      text: string;
      score: number | null;
      /** Deterministic, never AI-derived — see detectMissingValuesByColumn()/detectMalformedEntries() in data-analysis.ts. Distinct from statistical outliers on purpose: these are genuine data-integrity issues, not business signals that happen to be numerically unusual. */
      missingValues: ColumnIssue[];
      malformedEntries: ColumnIssue[];
      /** Columns that carried numbers but did not qualify as metrics, with the reason. See describeUnmeasuredColumns() in data-analysis.ts. Also deterministic. */
      unmeasured: UnmeasuredColumn[];
    };

// A Severity type and its parser lived here. The parser turned the model's
// "High"/"Medium"/"Low" into a Severity and the risk cards drew a 3x3 matrix
// from two of them. All of it is gone: the words were invented, not measured,
// and a risk now carries a computed Exposure figure instead.

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

/**
 * Strips a markdown emphasis wrapper (*word*, _word_, **word**, __word__)
 * around a short leading label, for when the model decorates a role/
 * category name despite nothing asking it to.
 *
 * BUG FIX (2026-10): seen wrapping the role in Mitigation Actions in plain
 * underscores -- "_Finance Team_: Assess and diversify..." -- which starts
 * with "_", not an uppercase letter, so extractLeadingRole's and Mitigation
 * Actions' own role regex both missed it outright and the raw underscores
 * were rendered to the reader. Only matches when the SAME marker opens and
 * closes immediately before a colon, so a genuine mid-sentence underscore
 * or asterisk is never touched, and it leaves the dedicated whole-line
 * "_Strategic Risk_"/"_Operational Risk_" tag convention alone -- that is
 * matched as its own "tag" line kind in parseReportLines (lib/report.ts)
 * before any text reaches this module.
 */
function stripEmphasisMarkers(text: string): string {
  const m = /^(\*{1,2}|_{1,2})([^*_]+?)\1(?=:)/.exec(text);
  return m ? text.replace(m[0], m[2]) : text;
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
/**
 * Counts how many figures across a built report were marked "unverified" by
 * Evidence Trail (Quick Wins' stat, Top Risks' signal/consequence -- the
 * only section kinds that carry an EvidenceResult). Used to show ONE
 * report-level summary line instead of repeating an inline badge next to
 * every single flagged figure (see ReportTabs.tsx) -- a reader who has
 * already been told "N figures in this report could not be confirmed"
 * doesn't need that restated on each one; the struck-through number itself
 * (see emphasizeParts/ReportVisual.tsx) is still what marks WHICH one.
 */
/**
 * How many figures the banner is about to list.
 *
 * Derived from the list rather than counted separately. The two used to be
 * computed independently and drifted the moment exposure was added to one of
 * them: a real report's banner read "1 figure in this version could not be
 * confirmed" directly above a list of two. A banner that cannot count its own
 * list is worse than no banner, because it is the component the reader is
 * meant to use to decide what to trust.
 */
export function countUnverifiedFigures(sections: VisualSection[]): number {
  return listUnverifiedFigures(sections).length;
}

export interface UnverifiedFigure {
  /** The figure as written in the report, e.g. "14.2%" or "$48,300.00". */
  figure: string;
  /** Where it appears, e.g. "Risk 2, consequence" or "Quick Win 1". */
  where: string;
}

/** First cited figure in a piece of text: same pattern, same order, as the highlighter in ReportVisual.tsx, so the banner names the figure the reader actually sees underlined. */
export function firstFigure(text: string | null): string | null {
  if (!text) return null;
  // The bare-decimal branch deliberately refuses a run that sits inside a
  // date or a version string: /\b[\d,]+\.\d{1,2}\b/ pulled "31.03" out of
  // "31.03.2025" and the report then warned about an unverified figure that
  // was never a figure. Kept in step with BARE_DECIMAL in lib/evidence.ts.
  const m = /\$[\d,]+\.\d{2}|\d+(?:\.\d+)?%|(?<![\d.,/-])[\d,]+\.\d{1,2}(?![\d])(?![.,/-]\d)/.exec(text);
  return m ? m[0] : null;
}

/**
 * The exposure as a percentage of the whole.
 *
 * A percentage in the text is taken as written. An absolute amount is divided
 * by the matching total: the prompt requires the exposure to say what it is a
 * share of, so the metric is named in the same sentence, and Nixara's own
 * evidence facts carry a "Total <metric> across N rows" entry for every
 * additive column. Without this the bar silently did not render whenever the
 * model chose to write money instead of a share.
 */
export function exposureShareOf(text: string, facts: EvidenceFact[]): number | null {
  // A SHARE of a whole, never a rate of change. The prompt requires the
  // exposure to say what it is a share of, so a genuine share always reads
  // "20.3% of total Billing Amount". A model that put a direction figure here
  // instead - "the total is rising ... (+33.2%)" - would otherwise have drawn
  // a bar a third of the way across, as though a third of the business were
  // at stake. A signed percentage is a change, and a percentage with no "of"
  // attached is not a share of anything this code can name.
  const pct =
    /(\d+(?:\.\d+)?)\s*%\s+of\b/i.exec(text) ??
    /\bof\b[^.]{0,40}?(\d+(?:\.\d+)?)\s*%/i.exec(text);
  if (pct) {
    const signed = new RegExp(`[+\\-\u2212]\\s*${pct[1].replace(".", "\\.")}\\s*%`).test(text);
    const v = Number(pct[1]);
    return !signed && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  }
  if (/%/.test(text)) return null;

  // Deliberately NOT firstFigure(), which requires decimals on a currency
  // amount and so missed the common "$290 million" shape entirely. Here the
  // first number in the text is the amount, whatever its decoration.
  const amountM = /\$?\s*([\d,]+(?:\.\d+)?)/.exec(text);
  if (!amountM) return null;
  const amount = Number(amountM[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  // "$290 million" is 290 in the text and 290,000,000 in the data, so the
  // magnitude word has to be applied before the division.
  const magnitude = /\b(million|billion|thousand|bn|mn)\b/i.exec(text);
  const scaled = magnitude
    ? amount *
      ({ thousand: 1e3, mn: 1e6, million: 1e6, bn: 1e9, billion: 1e9 }[magnitude[1].toLowerCase()] ?? 1)
    : amount;

  // The total it is a share of: a "Total <metric>" fact whose metric name
  // appears in the same sentence. Totals only, never an average or a maximum,
  // and never a figure Nixara derived from others.
  const lower = text.toLowerCase();
  const totals = facts.filter((f) => {
    if (f.isPercent || f.formula) return false;
    const m = /^Total (.+?) across /.exec(f.description);
    if (!m) return false;
    const words = m[1].toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    return words.length > 0 && words.some((w) => lower.includes(w));
  });
  if (totals.length !== 1) return null;

  const total = totals[0].value;
  if (!(total > 0)) return null;
  const share = (scaled / total) * 100;
  return share > 0 && share <= 100 ? share : null;
}


/**
 * The individual unverified figures, in the order the report renders them,
 * for the report-level banner (which links to each one). countUnverifiedFigures()
 * above is the cheap count; this adds which figure and where.
 */
export function listUnverifiedFigures(sections: VisualSection[]): UnverifiedFigure[] {
  const out: UnverifiedFigure[] = [];
  for (const s of sections) {
    if (s.kind === "quickWins") {
      s.items.forEach((item, i) => {
        if (item.evidence.status !== "unverified") return;
        const figure = item.stat ?? firstFigure(item.body);
        if (figure) out.push({ figure, where: `Quick Win ${i + 1}` });
      });
    } else if (s.kind === "topRisks") {
      s.risks.forEach((r, i) => {
        // Exposure is supposed to be a copied figure, so an unverified one is
        // the most important kind to list: it means the model estimated it.
        if (r.exposureEvidence.status === "unverified") {
          const figure = firstFigure(r.exposure);
          if (figure) out.push({ figure, where: `Risk ${i + 1}, exposure` });
        }
        if (r.signalEvidence.status === "unverified") {
          const figure = firstFigure(r.signal);
          if (figure) out.push({ figure, where: `Risk ${i + 1}, signal` });
        }
        if (r.consequenceEvidence.status === "unverified") {
          const figure = firstFigure(r.consequence);
          if (figure) out.push({ figure, where: `Risk ${i + 1}, consequence` });
        }
      });
    }
  }
  return out;
}

export function buildVisualSections(
  reportText: string,
  reportType: ReportType,
  evidenceFacts: EvidenceFact[] = [],
  /**
   * The real data quality score, computed directly from the dataset via
   * dashboardScore() -- the same number shown on the upload screen. Passed
   * in rather than parsed back out of the AI's own prose (see the
   * dataQuality case in parseSection below): the model is still asked to
   * write the surrounding sentence, but it is never trusted to have
   * restated the number correctly. null when no dataset is available to
   * score (parseSection then falls back to whatever the model wrote, if
   * anything, so the section still renders rather than showing nothing).
   */
  qualityScore: number | null = null,
  missingValues: ColumnIssue[] = [],
  malformedEntries: ColumnIssue[] = [],
  unmeasured: UnmeasuredColumn[] = []
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

  return buckets.map(({ heading, lines }) =>
    parseSection(heading, lines, reportType, evidenceFacts, qualityScore, missingValues, malformedEntries, unmeasured)
  );
}

function parseSection(
  heading: string,
  lines: ReportLine[],
  reportType: ReportType,
  evidenceFacts: EvidenceFact[],
  qualityScore: number | null,
  missingValues: ColumnIssue[],
  malformedEntries: ColumnIssue[],
  unmeasured: UnmeasuredColumn[]
): VisualSection {
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
        // BUG FIX (2026-10): the prompt now asks for an inference on its own
        // line (see report.ts), but a model that still folds a direct
        // finding and an inference into one run-on sentence -- "Efficiency
        // gaps appear in... Inferred: reviewing billing..." -- used to leak
        // the literal word "Inferred:" into the reader's prose, because the
        // badge detection below only ever matched it at the very start of a
        // line. flatMap so one input line can become the direct-finding
        // line plus a separately badged inferred line when that happens,
        // instead of silently failing to badge it at all.
        lines: lines
          .filter((l): l is Extract<ReportLine, { kind: "text" }> => l.kind === "text")
          .flatMap((l) => {
            if (/^Inferred:\s*/i.test(l.text)) {
              return [{ text: l.text.replace(/^Inferred:\s*/i, ""), inferred: true }];
            }
            const mid = /^(.*?[.!?])\s+Inferred:\s*(.+)$/i.exec(l.text);
            if (mid) {
              return [
                { text: mid[1].trim(), inferred: false },
                { text: mid[2].trim(), inferred: true },
              ];
            }
            return [{ text: l.text, inferred: false }];
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
            // BUG FIX (2026-10): the prompt's own template for this section --
            // "1. [This week] — one action... State the role responsible." --
            // only describes WHAT to include, unlike Mitigation Actions' now-
            // explicit worked example (see report.ts), so the model has been
            // seen doing two different things with it: treating the bracket
            // itself as a label by writing "[This week]: ...", which once the
            // bracket above is stripped leaves a bare leading ": " with
            // nothing in front of it; and echoing "State the role
            // responsible" back as a literal trailing "Responsible Role: X."
            // label instead of a leading "X: ". Both rendered straight to the
            // reader -- a stray leading colon, and the role never reaching
            // the role pill at all. Handled the same way Mitigation Actions
            // already handles its own "Role responsible:" echo: strip the
            // stray colon, recover a trailing "Responsible Role:" into the
            // real role field, and strip emphasis markers before the normal
            // leading-role extraction runs.
            const rest = (bracketMatch ? bracketMatch[2] : body).replace(/^:\s*/, "").trim();
            const trailingRoleMatch = /\.?\s*Responsible Role:\s*([A-Za-z/&\- ]{2,40})\.?\s*$/i.exec(rest);
            let role: string | null;
            let cleanBody: string;
            if (trailingRoleMatch) {
              role = trailingRoleMatch[1].trim();
              cleanBody = rest.slice(0, trailingRoleMatch.index).trim();
              if (cleanBody && !/[.!?]$/.test(cleanBody)) cleanBody += ".";
            } else {
              const leading = extractLeadingRole(stripEmphasisMarkers(rest));
              role = leading.role;
              cleanBody = leading.rest;
            }
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
            return { stat, body, evidence: stat ? findEvidence(stat, evidenceFacts) : { status: "none" as const } };
          }),
      };

    case "Top Risks Identified": {
      const risks: RiskCard[] = [];
      let cur: Partial<RiskCard> | null = null;

      const flush = (c: Partial<RiskCard>) => {
        risks.push({
          // With no name line, the exposure sentence is the best headline
          // available, then the signal. The card detects when the headline
          // IS the exposure and renders the sentence once, keeping the bar
          // and the evidence tag.
          name: c.name ?? c.exposure ?? c.signal ?? "Risk",
          exposure: c.exposure ?? null,
          exposureEvidence: c.exposure ? findEvidence(c.exposure, evidenceFacts) : { status: "none" as const },
          exposureShare: c.exposure ? exposureShareOf(c.exposure, evidenceFacts) : null,
          signal: c.signal ?? null,
          consequence: c.consequence ?? null,
          type: c.type ?? null,
          signalEvidence: c.signal ? findEvidence(c.signal, evidenceFacts) : { status: "none" as const },
          consequenceEvidence: c.consequence ? findEvidence(c.consequence, evidenceFacts) : { status: "none" as const },
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
        const exposureM = /^Exposure:\s*(.*)$/i.exec(l.text);
        // The prompt forbids these two, but a model that emits one anyway
        // must not have it read as the next risk's NAME. Swallowed, not shown.
        const ratingM = /^(?:Likelihood|Impact):\s*/i.exec(l.text);
        const signalM = /^Signal:\s*(.*)$/i.exec(l.text);
        const consequenceM = /^Consequence:\s*(.*)$/i.exec(l.text);

        // A labelled field with no risk open means the model skipped the name
        // line and led with the field. Seen in production the day Exposure
        // shipped: every risk began "Exposure: ..." with no name above it, so
        // this branch never fired, the line fell through to the name branch,
        // and the card rendered the exposure text as the risk's title with no
        // bar and no evidence tag. Open a risk instead of losing the field.
        if (!cur && (exposureM || signalM || consequenceM)) cur = {};

        if (exposureM && cur) {
          // An Exposure has to be a FIGURE. The prompt offers the phrase
          // "assumption, not from your data" for a claim that cannot be
          // traced, and a model put that phrase in the Exposure field, where
          // it became the risk's headline: a card titled "assumption, not
          // from your data". A field with no digit in it is not an exposure,
          // so it is dropped rather than shown as one.
          const text = exposureM[1].trim();
          if (/\d/.test(text)) cur.exposure = text;
          continue;
        }
        if (ratingM && cur) continue;
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
            // BUG FIX (2026-09): the prompt's format string was ambiguous
            // enough that the model sometimes echoed its literal words
            // ("Role responsible: Finance Team: ...") instead of substituting
            // an actual role, and sometimes wrote "Begin within" instead of
            // "Start within" -- either deviation made this regex miss
            // entirely, silently falling through to the plain-text case
            // below, so that one action rendered as a bare bullet with no
            // role pill while its sibling lines (which happened to match)
            // got one. Fixed at the prompt too (see report.ts), but handled
            // defensively here as well so a future model wording drift
            // degrades to "role stripped, action shown" rather than "role
            // pill silently missing" again.
            const cleaned = stripEmphasisMarkers(body).replace(/^role responsible:\s*/i, "");
            const m = /^([A-Z][A-Za-z/&\- ]{2,40}):\s*(.+?)\s*[-–—]\s*(?:Start|Begin) within\s*(.+?)\.?\s*$/i.exec(cleaned);
            if (m) return { role: m[1].trim(), action: m[2].trim(), timeframe: m[3].trim() };
            return { role: null, action: body, timeframe: null };
          }),
      };

    case "Data Quality Risks": {
      // BUG FIX (2026-09): this used to regex-scrape "score: X/100" back out
      // of the AI's own sentence -- the exact anti-pattern the rest of this
      // file's header comment warns against, just for this one section. The
      // model was asked to restate a number it was handed, and the ring
      // gauge then trusted whatever it wrote back, with no guarantee the two
      // ever agreed. qualityScore now comes from dashboardScore(dataset) --
      // computed once, shown identically on the upload screen and here.
      // Defensively strip any stray "(score: X/100)" the model writes anyway
      // (the prompt now tells it not to), so a leftover fragment never
      // shows a second, possibly different number next to the real one.
      const rawText = lines.map(anyLineText).filter((t): t is string => t !== null).join(" ");
      const text = rawText.replace(/\(?\s*score:\s*\[?\d+\]?\s*\/\s*100\s*\)?\.?/gi, "").replace(/\s{2,}/g, " ").trim();
      return { kind: "dataQuality", heading, text, score: qualityScore, missingValues, malformedEntries, unmeasured };
    }

    default:
      return {
        kind: "prose",
        heading,
        lines: lines.map((l) => (l.kind === "text" ? l.text : l.kind === "bullet" ? `• ${l.text}` : l.kind === "numbered" ? l.text : "")).filter(Boolean),
      };
  }
}
