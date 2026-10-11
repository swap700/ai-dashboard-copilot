/**
 * Evidence Trail — "click a number, see its source."
 *
 * Extends what already exists rather than green-fielding a citation system:
 * report-visual.ts already parses Top Risks' Signal:/Consequence: fields and
 * already runs extractFirstStat() over Quick Wins to pull out a headline
 * number. This module gives those extracted numbers something to point at.
 *
 * The report text itself carries no pointer back to its source — the model
 * just writes prose — so this works backwards: it rebuilds a bounded set of
 * the same stats/breakdowns buildDataSummary() computed when the report was
 * generated (lib/data-analysis.ts), then matches a cited figure against them
 * by value.
 *
 * This is necessarily best-effort, not a guarantee in either direction. A
 * match requires the cited figure to equal (within rounding) something
 * Nixara actually computed — true for the large majority of cited figures,
 * since the prompts instruct the model to cite the provided numbers rather
 * than invent new ones, but not airtight against paraphrased or derived
 * figures, which will read as "unverified" even though they may be correct.
 * Conversely, a numeric match within tolerance doesn't prove the model's
 * surrounding claim about that number is accurate — only that the number
 * itself traces back to something real. Treat "matched" as "this figure is
 * real," "unverified" as "this figure needs a second look," and neither as
 * a verdict on the sentence around it.
 */

import {
  aggregateBy,
  breakdownColumns,
  categoricalColumns,
  collectConfounding,
  columnsWithRole,
  computeDerivedFigures,
  hasUsableGroupSize,
  looksLikeProportion,
  numericStats,
  rankedBusinessMetrics,
  smartAgg,
  columnMatchScore,
  tokenize,
  type Dataset,
} from "./data-analysis";
import { collectRiskEvidence } from "./risk-evidence";
import { computeScenarios } from "./scenario";

/**
 * A bare decimal, but never one that is part of a date or a version string.
 *
 * The old pattern was /\b[\d,]+\.\d{1,2}\b/, which matches "31.03" inside
 * "31.03.2025". A European date in a report therefore produced an unverified
 * figure, and the report carried a warning about a number that was never a
 * number. The lookarounds require the run to be bounded by something that is
 * not another digit group: "1,234.56" matches, "31.03.2025" and "1.2.3" do not.
 */
const BARE_DECIMAL = String.raw`(?<![\d.,/-])[\d,]+\.\d{1,2}(?![\d])(?![.,/-]\d)`;

export interface EvidenceFact {
  /** In the same scale the cited text would use: 34.2 for "34.2%", 1234.56 for "$1,234.56". */
  value: number;
  isPercent: boolean;
  description: string;
  /**
   * Set only for figures Nixara computed from other figures (a margin, a
   * share of total): how it was computed. Its presence is what makes the UI
   * label the figure "calculated" instead of "source".
   */
  formula?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pushColumnStatFacts(facts: EvidenceFact[], col: string, values: number[]): void {
  if (values.length === 0) return;
  const stats = numericStats(values);
  const agg = smartAgg(col, values);
  const proportion = looksLikeProportion(values);

  if (agg === "sum") {
    facts.push({ value: round2(stats.total), isPercent: false, description: `Total ${col} across ${stats.count} rows` });
  }
  facts.push({ value: round2(stats.mean), isPercent: false, description: `Average ${col} across ${stats.count} rows` });
  if (proportion) {
    facts.push({ value: round2(stats.mean * 100), isPercent: true, description: `Average ${col} across ${stats.count} rows` });
  }
  facts.push({ value: round2(stats.max), isPercent: false, description: `Highest ${col} value, out of ${stats.count} rows` });
  facts.push({ value: round2(stats.min), isPercent: false, description: `Lowest ${col} value, out of ${stats.count} rows` });
}

/**
 * Rebuilds a bounded set of candidate facts: per-column stats for up to 12
 * business-metric columns, plus per-category breakdowns for up to 4
 * low-cardinality categorical columns crossed with up to 4 of those metric
 * columns. Capped throughout — this only needs to be good enough to catch
 * the figures a report actually cites, not an exhaustive index of every
 * column × category combination, and numericStats/detectAnomalies were
 * already hardened against multi-hundred-thousand-row files (see their
 * bug-fix notes), so keeping this bounded matters on the same files.
 */
/**
 * Figures Nixara computed itself, outside the per-column statistics.
 *
 * THE BUG THIS EXISTS FOR. The summary hands the model a RISK EVIDENCE block,
 * a TARGET ARITHMETIC block and a CONTROLLED COMPARISON block, and instructs
 * it to copy those figures exactly rather than recompute them. The model did
 * exactly that. The evidence checker then knew nothing about any of them, so
 * it marked Nixara's own arithmetic "could not be confirmed against your
 * data" and the verify-and-correct pass DELETED some of it.
 *
 * On a real healthcare report that produced: "$13,363,704.00 — unverified"
 * for the duplicate billing Nixara had computed, "$53,925.00 — unverified"
 * for the negative total it had computed, and a correction notice saying it
 * had removed 0.9% from the first draft, which was its own duplicate share.
 * Three of the most solid numbers in the report, each flagged as doubtful by
 * the component whose whole job is telling the reader which numbers to
 * trust. For a product whose argument is "every figure is worth checking",
 * nothing is more damaging than failing to recognise its own.
 */
function pushComputedBlockFacts(
  facts: EvidenceFact[],
  dataset: Dataset,
  question: string,
  consequenceColumns: string[]
): void {
  const { primaryMetric } = rankedBusinessMetrics(dataset);
  if (!primaryMetric) return;

  const labelCols = breakdownColumns(dataset).filter((c) => hasUsableGroupSize(dataset, c));
  const lowCardCats = labelCols.filter((col) => {
    const u = new Set(dataset.rows.map((r) => r[col])).size;
    return u >= 2 && u <= 20;
  });

  // ── RISK EVIDENCE ────────────────────────────────────────────────────────
  const evidence = collectRiskEvidence(
    dataset,
    primaryMetric,
    labelCols,
    columnsWithRole(dataset, "date")
  );
  if (evidence) {
    for (const c of evidence.concentration) {
      facts.push({ value: round2(c.topShare * 100), isPercent: true,
        description: `${c.topLevel} share of total ${evidence.metric}`, formula: "group total / overall total" });
      facts.push({ value: round2(c.topFiveShare * 100), isPercent: true,
        description: `Top five ${c.column} share of total ${evidence.metric}`, formula: "top five total / overall total" });
      facts.push({ value: round2(c.topFifthShare * 100), isPercent: true,
        description: `Top ${c.topFifthCount} of ${c.levels} ${c.column} share of total ${evidence.metric}`, formula: "top fifth total / overall total" });
      facts.push({ value: round2(c.evenShare * 100), isPercent: true,
        description: `An even split across ${c.levels} ${c.column} values` });
    }
    const d = evidence.direction;
    if (d) {
      facts.push({ value: round2(d.firstValue), isPercent: false, description: `Total ${d.metric} in ${d.firstPeriod}` });
      facts.push({ value: round2(d.lastValue), isPercent: false, description: `Total ${d.metric} in ${d.lastPeriod}` });
      facts.push({ value: round2(d.change * 100), isPercent: true,
        description: `Change in total ${d.metric} from ${d.firstPeriod} to ${d.lastPeriod}`, formula: "(last - first) / first" });
      facts.push({ value: round2(Math.abs(d.change * 100)), isPercent: true,
        description: `Change in total ${d.metric} from ${d.firstPeriod} to ${d.lastPeriod}`, formula: "(last - first) / first" });
      facts.push({ value: d.lastPeriodRows, isPercent: false, description: `Rows in the latest period, ${d.lastPeriod}` });
      facts.push({ value: d.typicalPeriodRows, isPercent: false, description: `Rows in a typical period of ${d.dateColumn}` });
    }
    const i = evidence.integrity;
    if (i) {
      // Both signs for the negative total: the model writes it as "-$53,925"
      // in one sentence and "$53,925" in the next, and both are the same fact.
      facts.push({ value: round2(i.duplicateValue), isPercent: false,
        description: `${i.duplicateRows.toLocaleString()} duplicate rows carry this much ${i.metric}`, formula: "sum of the metric on every repeat beyond the first" });
      facts.push({ value: round2(i.total === 0 ? 0 : (i.duplicateValue / i.total) * 100), isPercent: true,
        description: `Duplicate rows as a share of total ${i.metric}`, formula: "duplicate total / overall total" });
      facts.push({ value: round2(i.negativeValue), isPercent: false,
        description: `${i.negativeRows.toLocaleString()} rows hold a negative ${i.metric}, totalling this` });
      facts.push({ value: round2(Math.abs(i.negativeValue)), isPercent: false,
        description: `${i.negativeRows.toLocaleString()} rows hold a negative ${i.metric}, totalling this` });
      facts.push({ value: i.duplicateRows, isPercent: false, description: `Exact duplicate rows` });
      facts.push({ value: i.negativeRows, isPercent: false, description: `Rows with a negative ${i.metric}` });
      facts.push({ value: round2(i.total), isPercent: false, description: `Total ${i.metric}` });
    }
  }

  // ── TARGET ARITHMETIC ────────────────────────────────────────────────────
  if (question.trim() !== "") {
    const scenario = computeScenarios(dataset, primaryMetric, labelCols, question);
    if (scenario) {
      facts.push({ value: round2(scenario.overallTotal), isPercent: false, description: `Total ${scenario.metric}` });
      facts.push({ value: round2(scenario.overallMean), isPercent: false, description: `Average ${scenario.metric} per row` });
      facts.push({ value: round2(scenario.targetTotal), isPercent: false,
        description: `The stated target in ${scenario.metric}`, formula: "total x the percentage asked for" });
      facts.push({ value: round2(scenario.targetPerRow), isPercent: false,
        description: `The stated target per row`, formula: "target total / rows" });
      facts.push({ value: round2(scenario.target.fraction * 100), isPercent: true, description: `The reduction the question asks for` });
      for (const lever of scenario.levers) {
        facts.push({ value: round2(lever.gapPerRow), isPercent: false,
          description: `${lever.label}: gap between ${lever.worse} and ${lever.better} per affected row` });
        facts.push({ value: round2(lever.valuePerRow), isPercent: false,
          description: `${lever.label}: value per row of the whole file if that gap closed` });
        facts.push({ value: round2(lever.shareOfTotal * 100), isPercent: true,
          description: `${lever.label}: share of total ${scenario.metric} if that gap closed` });
        facts.push({ value: round2(lever.coverOfTarget * 100), isPercent: true,
          description: `${lever.label}: share of the stated target it would cover` });
        facts.push({ value: round2(lever.affectedShare * 100), isPercent: true,
          description: `${lever.label}: share of rows in ${lever.worse}` });
      }
    }
  }

  // ── CONTROLLED COMPARISON ────────────────────────────────────────────────
  if (lowCardCats.length > 0) {
    for (const c of collectConfounding(dataset, question, consequenceColumns)) {
      facts.push({ value: round2(c.rawGap), isPercent: false,
        description: `${c.group}: raw gap between ${c.highGroup} and ${c.lowGroup} on ${c.metric}` });
      facts.push({ value: round2(c.adjustedGap), isPercent: false,
        description: `${c.group}: adjusted gap between ${c.highGroup} and ${c.lowGroup} on ${c.metric}`, formula: "least squares, holding the other columns steady" });
      facts.push({ value: round2(c.adjustedGapLow), isPercent: false, description: `${c.group}: low end of the 95% range` });
      facts.push({ value: round2(c.adjustedGapHigh), isPercent: false, description: `${c.group}: high end of the 95% range` });
      if (c.adjustedGapExcludingMediators !== null) {
        facts.push({ value: round2(c.adjustedGapExcludingMediators), isPercent: false,
          description: `${c.group}: adjusted gap with the possible consequences left out` });
      }
    }
  }
}

export interface EvidenceFactOptions {
  /** What the user asked. The target arithmetic and the controlled comparison both depend on it. */
  question?: string;
  /** Columns the user marked as consequences, so the facts match the comparison that was run. */
  consequenceColumns?: string[];
}

export function buildEvidenceFacts(dataset: Dataset, opts: EvidenceFactOptions = {}): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  // Same ranking buildDataSummary() uses to decide which metrics the model
  // sees first in BREAKDOWN/CROSS-BREAKDOWN sections (see rankedBusinessMetrics
  // in data-analysis.ts) -- not independently re-derived here, so this can never
  // build facts for a different "top metrics" set than the one actually shown
  // to the model. BUG FIX (2026-10): it used to be businessMetricColumns(dataset)
  // in raw left-to-right column order, which silently excluded whichever metric
  // the model was actually told mattered most whenever that metric wasn't one of
  // the first few columns as authored -- see rankedBusinessMetrics's own comment
  // for the real dataset this was confirmed against.
  const metricCols = rankedBusinessMetrics(dataset).ranked.slice(0, 12);
  const catCols = categoricalColumns(dataset);

  const colValues = new Map<string, number[]>();
  for (const col of metricCols) {
    const values = dataset.rows.map((r) => r[col]).filter((v): v is number => typeof v === "number");
    colValues.set(col, values);
    pushColumnStatFacts(facts, col, values);
  }

  // Ranked by the question before the cap, exactly as buildDataSummary ranks
  // them. Taking the first four in FILE order excluded Admission Type on a
  // real healthcare file -- a column the question named, whose breakdown the
  // summary therefore showed and whose figures the report duly quoted, every
  // one of them coming back unverified because the checker had never built a
  // fact for it. This is the same fault the metric list was fixed for in
  // October: the checker and the summary ranking differently.
  const question = opts.question ?? "";
  const qTokens = question.trim() === "" ? null : new Set(tokenize(question));
  const lowCardCats = catCols
    .filter((col) => {
      const u = new Set(dataset.rows.map((r) => r[col])).size;
      return u >= 2 && u <= 20;
    })
    .sort((a, b) =>
      qTokens === null
        ? 0
        : columnMatchScore(dataset, b, question, qTokens) - columnMatchScore(dataset, a, question, qTokens)
    )
    .slice(0, 6);

  for (const cat of lowCardCats) {
    for (const metric of metricCols.slice(0, 4)) {
      const values = colValues.get(metric) ?? [];
      const proportion = looksLikeProportion(values);
      const breakdown = aggregateBy(dataset, cat, metric).points;
      for (const { key, value } of breakdown) {
        const description = `${metric} for ${cat} = ${key}`;
        facts.push({ value: round2(value), isPercent: false, description });
        if (proportion) {
          facts.push({ value: round2(value * 100), isPercent: true, description });
        }
      }
    }
  }

  // Figures Nixara computes itself (see computeDerivedFigures). The same list
  // is printed in the summary the model reads, so what the model is told to
  // copy and what the checker accepts can no longer disagree.
  for (const d of computeDerivedFigures(dataset)) {
    facts.push({ value: d.value, isPercent: true, description: d.label, formula: d.formula });
  }

  // And every figure the judgement blocks put in front of the model.
  pushComputedBlockFacts(facts, dataset, opts.question ?? "", opts.consequenceColumns ?? []);

  return facts;
}

/**
 * Does a cited figure match a computed one?
 *
 * THE BUG THIS EXISTS FOR. The tolerance was a flat 0.05, absolute, at every
 * magnitude. That asks a model to reproduce a thirteen-million-dollar figure
 * to the cent, which it will not do and which the summary does not print to
 * the cent either. On a real healthcare report the duplicate-billing total
 * came back unverified because Nixara computed $13,363,704.06 and the report
 * said $13,363,704.00 - six cents on thirteen million dollars, shown to the
 * reader as a figure that could not be confirmed. The negative total missed
 * by forty-seven cents and the stated target by twenty.
 *
 * Two allowances, and a match needs only the larger:
 *
 *   ONE WHOLE UNIT, for a non-percentage. Covers dropped or rounded cents on
 *   a total of any size, and nothing else: at thirteen million it is still
 *   one dollar, so a fabricated 13,370,000 fails by six thousand.
 *   HALF THE LAST WRITTEN DIGIT, scaled by any magnitude word. "20.3%" is
 *   anything from 20.25 to 20.35. "$13.4 million" is anything from 13.35m to
 *   13.45m, which is what writing it that way means.
 *
 * A percentage gets only the second: percentages are small numbers written to
 * one or two decimals, and a whole-unit allowance would let 20.3 match 21.
 *
 * (An earlier version of this fix used a relative tolerance of one part in
 * 100,000. That was looser than it needed to be - 134 dollars of slack at
 * thirteen million - and the one-unit floor covers every real case without
 * it. Kept as a note because loosening a verifier is a trade worth recording:
 * every widening here lets some fabricated figure through, so each one has to
 * buy back a false alarm that was doing more damage.)
 */
const MAGNITUDE_SCALE: Record<string, number> = {
  thousand: 1e3, k: 1e3,
  million: 1e6, m: 1e6, mn: 1e6,
  billion: 1e9, bn: 1e9, b: 1e9,
  trillion: 1e12,
};

/** The magnitude word, if any, written straight after this figure. */
function magnitudeAfter(written: string, context?: string): number {
  if (!context) return 1;
  const at = context.indexOf(written);
  if (at < 0) return 1;
  const after = context.slice(at + written.length, at + written.length + 14);
  const word = /^\s*(thousand|million|billion|trillion|bn|mn|[kmb])\b/i.exec(after)?.[1]?.toLowerCase();
  return word ? MAGNITUDE_SCALE[word] ?? 1 : 1;
}

function closeEnough(a: number, b: number, written?: string, context?: string): boolean {
  const isPercentToken = written !== undefined && written.trim().endsWith("%");
  // "13.4 million" is thirteen point four MILLION, and it is precise to a
  // hundred thousand rather than to a tenth. The word scales both the figure
  // and what counts as agreement with it.
  const scale = written && !isPercentToken ? magnitudeAfter(written, context) : 1;
  const target = b * scale;
  const diff = Math.abs(a - target);

  const decimals = written ? (/\.(\d+)/.exec(written)?.[1].length ?? 0) : 0;
  const precisionTol = written ? 0.5 * Math.pow(10, -decimals) * scale : 0;
  const unitTol = isPercentToken ? 0 : 1;
  return diff <= Math.max(0.05, precisionTol, unitTol);
}

export type EvidenceResult =
  | { status: "matched"; fact: EvidenceFact }
  | { status: "unverified" } // a specific figure was cited, but nothing in the real data matches it
  | { status: "none" };      // no specific figure was present in this text at all

/**
 * Parses ONE cited figure out of `text` ($X,XXX.XX / NN.N% / a bare decimal
 * like "11.70") and looks for a fact whose value matches within rounding
 * tolerance. Callers pass a specific extracted field (a Signal, a
 * Consequence, a Quick Win's stat) rather than a whole paragraph.
 *
 * BUG FIX (2026-09): this used to return EvidenceFact | null, which made "no
 * specific number was in this text" and "a specific number was cited but
 * doesn't match anything real" indistinguishable to the caller — both just
 * rendered as an ordinary, unlinked number. That silently let a fabricated
 * figure ("average experience of 11.70 years" — not present anywhere in the
 * actual dataset, confirmed by independently recomputing every real subgroup
 * mean) through with no visual difference from a correct one. The bare-
 * decimal pattern also didn't previously match at all — only $-amounts and
 * percentages were checked, so a plain "11.70 years" wasn't even examined.
 * The distinct "unverified" status lets the UI flag that case specifically,
 * instead of only ever showing a link when one exists and staying silent
 * otherwise.
 */
export function findEvidence(text: string, facts: EvidenceFact[]): EvidenceResult {
  const dollarM = /\$([\d,]+\.\d{2})/.exec(text);
  if (dollarM) {
    const target = Number(dollarM[1].replace(/,/g, ""));
    const fact = facts.find((f) => !f.isPercent && closeEnough(f.value, target, dollarM[0], text));
    return fact ? { status: "matched", fact } : { status: "unverified" };
  }
  const pctM = /(\d+(?:\.\d+)?)%/.exec(text);
  if (pctM) {
    const target = Number(pctM[1]);
    const fact = facts.find((f) => f.isPercent && closeEnough(f.value, target, pctM[0], text));
    return fact ? { status: "matched", fact } : { status: "unverified" };
  }
  // Bare decimal with no $ or % — e.g. "11.70 years", "3.03", "12.47".
  // Excludes whole integers (no decimal point) since those are far more
  // likely to be counts/ranks/years-as-labels than a specific measured
  // figure worth verifying, and would produce too many false positives.
  const bareM = new RegExp(`(${BARE_DECIMAL})(?!%)`).exec(text);
  if (bareM) {
    const target = Number(bareM[1]);
    const fact = facts.find((f) => !f.isPercent && closeEnough(f.value, target, bareM[0], text));
    return fact ? { status: "matched", fact } : { status: "unverified" };
  }
  return { status: "none" };
}

/** Fresh regex per call (a shared /g regex carries lastIndex between uses). */
function figurePattern(): RegExp {
  return new RegExp(String.raw`\$[\d,]+\.\d{2}|\d+(?:\.\d+)?%|` + BARE_DECIMAL, "g");
}

/**
 * `context` is the whole line the token came from, so a magnitude word
 * written after the figure ("13.4 million") can be seen. Without it every
 * figure written that way is compared against its face value and fails.
 */
function figureIsVerified(token: string, facts: EvidenceFact[], context?: string): boolean {
  let value: number;
  let isPercent = false;
  if (token.startsWith("$")) {
    value = Number(token.slice(1).replace(/,/g, ""));
  } else if (token.endsWith("%")) {
    value = Number(token.slice(0, -1));
    isPercent = true;
  } else {
    value = Number(token.replace(/,/g, ""));
  }
  return facts.some((f) => f.isPercent === isPercent && closeEnough(f.value, value, token, context ?? token));
}

/**
 * Whole-report verification for the server-side generate -> verify -> correct
 * loop (generate-report/route.ts) - a different job from findEvidence()
 * above, which only ever examines the first number in one short pre-parsed
 * field for the on-screen badge. This scans every line of the full report
 * text and checks EVERY numeric claim on that line, not just the first - a
 * fabricated second figure sharing a sentence with a correct first figure
 * would otherwise be invisible to the per-field check entirely.
 *
 * Returns the full text of every line containing at least one unverified
 * figure, deduplicated, so a correction prompt has real sentence context.
 */
export function findUnverifiedLines(text: string, facts: EvidenceFact[]): string[] {
  const flagged: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || seen.has(line)) continue;
    const tokens = [...line.matchAll(figurePattern())].map((m) => m[0]);
    if (tokens.some((t) => !figureIsVerified(t, facts, line))) {
      seen.add(line);
      flagged.push(line);
    }
  }
  return flagged;
}

/**
 * The individual figures (not whole lines) that could not be matched, in the
 * order they first appear, deduplicated. Used to tell the reader exactly which
 * first-draft figures were replaced during an automatic correction.
 */
export function findUnverifiedFigures(text: string, facts: EvidenceFact[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(figurePattern())) {
    const token = m[0];
    if (seen.has(token)) continue;
    seen.add(token);
    if (!figureIsVerified(token, facts, text)) out.push(token);
  }
  return out;
}
