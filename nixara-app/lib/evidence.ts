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
  businessMetricColumns,
  categoricalColumns,
  looksLikeProportion,
  numericStats,
  smartAgg,
  type Dataset,
} from "./data-analysis";

export interface EvidenceFact {
  /** In the same scale the cited text would use: 34.2 for "34.2%", 1234.56 for "$1,234.56". */
  value: number;
  isPercent: boolean;
  description: string;
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
export function buildEvidenceFacts(dataset: Dataset): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  const metricCols = businessMetricColumns(dataset).slice(0, 12);
  const catCols = categoricalColumns(dataset);

  const colValues = new Map<string, number[]>();
  for (const col of metricCols) {
    const values = dataset.rows.map((r) => r[col]).filter((v): v is number => typeof v === "number");
    colValues.set(col, values);
    pushColumnStatFacts(facts, col, values);
  }

  const lowCardCats = catCols
    .filter((col) => {
      const u = new Set(dataset.rows.map((r) => r[col])).size;
      return u >= 2 && u <= 20;
    })
    .slice(0, 4);

  for (const cat of lowCardCats) {
    for (const metric of metricCols.slice(0, 4)) {
      const values = colValues.get(metric) ?? [];
      const proportion = looksLikeProportion(values);
      const breakdown = aggregateBy(dataset, cat, metric);
      for (const { key, value } of breakdown) {
        const description = `${metric} for ${cat} = ${key}`;
        facts.push({ value: round2(value), isPercent: false, description });
        if (proportion) {
          facts.push({ value: round2(value * 100), isPercent: true, description });
        }
      }
    }
  }

  return facts;
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.05;
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
    const fact = facts.find((f) => !f.isPercent && closeEnough(f.value, target));
    return fact ? { status: "matched", fact } : { status: "unverified" };
  }
  const pctM = /(\d+(?:\.\d+)?)%/.exec(text);
  if (pctM) {
    const target = Number(pctM[1]);
    const fact = facts.find((f) => f.isPercent && closeEnough(f.value, target));
    return fact ? { status: "matched", fact } : { status: "unverified" };
  }
  // Bare decimal with no $ or % — e.g. "11.70 years", "3.03", "12.47".
  // Excludes whole integers (no decimal point) since those are far more
  // likely to be counts/ranks/years-as-labels than a specific measured
  // figure worth verifying, and would produce too many false positives.
  const bareM = /\b(\d+\.\d{1,2})\b(?!%)/.exec(text);
  if (bareM) {
    const target = Number(bareM[1]);
    const fact = facts.find((f) => !f.isPercent && closeEnough(f.value, target));
    return fact ? { status: "matched", fact } : { status: "unverified" };
  }
  return { status: "none" };
}

/**
 * Whole-report verification for the server-side generate → verify → correct
 * loop (generate-report/route.ts) — a different job from findEvidence()
 * above, which only ever examines the first number in one short pre-parsed
 * field (a single Signal, Consequence, or Quick Win stat) for the on-screen
 * badge. This scans every line of the full report text and checks EVERY
 * numeric claim on that line, not just the first — a fabricated second
 * figure sharing a sentence with a correct first figure would otherwise be
 * invisible to the per-field check entirely (confirmed gap: Risk #3's
 * Signal in an earlier real report cited two figures, "12.71" and "12.11",
 * and only the first was ever examined).
 *
 * Returns the full text of every line containing at least one unverified
 * figure, deduplicated, so a correction prompt has real sentence context —
 * not an isolated number with no surrounding meaning — to work with.
 */
export function findUnverifiedLines(text: string, facts: EvidenceFact[]): string[] {
  const NUMBER_PATTERN = /\$[\d,]+\.\d{2}|\d+(?:\.\d+)?%|\b\d+\.\d{1,2}\b/g;
  const flagged: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || seen.has(line)) continue;

    const matches = [...line.matchAll(NUMBER_PATTERN)];
    if (matches.length === 0) continue;

    const hasUnverified = matches.some((m) => {
      const token = m[0];
      let value: number;
      let isPercent = false;
      if (token.startsWith("$")) {
        value = Number(token.slice(1).replace(/,/g, ""));
      } else if (token.endsWith("%")) {
        value = Number(token.slice(0, -1));
        isPercent = true;
      } else {
        value = Number(token);
      }
      return !facts.some((f) => f.isPercent === isPercent && closeEnough(f.value, value));
    });

    if (hasUnverified) {
      seen.add(line);
      flagged.push(line);
    }
  }

  return flagged;
}
