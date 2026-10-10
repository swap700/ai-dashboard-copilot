/**
 * When the question states a target, do the arithmetic.
 *
 * "We need to cut billing exposure by 10% next year... what would that
 * save?" got a five-page report with no savings figure anywhere, on a file
 * whose total the engine already knew. "Cut annual medical cost per member
 * by 8%... rank these three by the saving each could deliver" got a ranking
 * with no numbers at all.
 *
 * The model cannot be blamed for either. It was handed group totals and no
 * target, so it had nothing to divide. The arithmetic is four lines and it
 * is the literal question, so Nixara computes it and hands over the answer:
 * what the target is worth, and what closing each gap would actually
 * deliver against it.
 *
 * The honest part is the denominator. Closing a gap between two groups is
 * not a saving you can book; it is the size of the prize if the gap were
 * entirely removed and entirely caused by the thing you are naming. Both
 * are strong assumptions, so the output says so rather than presenting a
 * ceiling as a forecast.
 */

import type { Dataset } from "./data-analysis";
import { compareGroups } from "./materiality";

export interface Target {
  /** The fraction asked for, e.g. 0.10 for "cut by 10%". */
  fraction: number;
  direction: "cut" | "increase";
  /** The phrase it was read from, so the summary can quote it back. */
  phrase: string;
}

export interface Lever {
  label: string;
  /** The group carrying the higher value. */
  worse: string;
  /** The group carrying the lower value, treated as the achievable floor. */
  better: string;
  /** Per-row gap between them. */
  gapPerRow: number;
  /** Share of all rows sitting in the worse group. */
  affectedShare: number;
  /** Gap closed across those rows, expressed per row of the whole file. */
  valuePerRow: number;
  /** That value as a share of the metric's overall mean. */
  shareOfTotal: number;
  /** How much of the stated target it would cover, 1 = exactly the target. */
  coverOfTarget: number;
}

export interface ScenarioResult {
  metric: string;
  overallMean: number;
  overallTotal: number;
  rows: number;
  target: Target;
  targetPerRow: number;
  targetTotal: number;
  levers: Lever[];
}

/**
 * Reads a percentage target out of the question.
 *
 * Only a percentage, and only next to a word that says which way. A bare
 * number in a sentence is not a target, and guessing one would put a
 * fabricated denominator under every figure that follows.
 */
export function parseTarget(question: string): Target | null {
  const text = question.toLowerCase();
  const re = /(\d{1,3}(?:\.\d+)?)\s*(?:%|per\s?cent|percent)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const pct = Number(m[1]);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) continue;
    const window = text.slice(Math.max(0, m.index - 60), m.index + 20);
    const cut = /\b(cut|reduce|reduction|lower|save|saving|savings|decrease|down|trim|shave)\b/.test(window);
    const up = /\b(increase|grow|growth|raise|lift|improve|up by)\b/.test(window);
    if (!cut && !up) continue;
    return { fraction: pct / 100, direction: cut ? "cut" : "increase", phrase: m[0] };
  }
  return null;
}

/**
 * What each label column could deliver against the target, best lever first.
 *
 * A lever is only offered where the difference between groups survived the
 * materiality test. Sizing a saving from a gap that is statistical noise is
 * how a rounding error becomes a budget line.
 */
export function computeScenarios(
  dataset: Dataset,
  metric: string,
  labels: string[],
  question: string
): ScenarioResult | null {
  const target = parseTarget(question);
  if (!target) return null;

  const values = dataset.rows
    .map((r) => r[metric])
    .filter((v): v is number => typeof v === "number");
  if (values.length < 10) return null;

  const overallTotal = values.reduce((a, b) => a + b, 0);
  const overallMean = overallTotal / values.length;
  if (overallMean === 0) return null;

  const levers: Lever[] = [];
  for (const label of labels) {
    const c = compareGroups(dataset, label, metric, "mean");
    if (!c || c.verdict === "tied") continue;

    const byMean = [...c.groups].sort((a, b) => b.mean - a.mean);
    const worse = byMean[0];
    const better = byMean[byMean.length - 1];
    const gapPerRow = worse.mean - better.mean;
    if (gapPerRow <= 0) continue;

    const affectedShare = worse.rows / values.length;
    const valuePerRow = gapPerRow * affectedShare;
    levers.push({
      label,
      worse: worse.key,
      better: better.key,
      gapPerRow,
      affectedShare,
      valuePerRow,
      shareOfTotal: valuePerRow / overallMean,
      coverOfTarget: valuePerRow / (overallMean * target.fraction),
    });
  }

  levers.sort((a, b) => b.valuePerRow - a.valuePerRow);
  return {
    metric,
    overallMean,
    overallTotal,
    rows: values.length,
    target,
    targetPerRow: overallMean * target.fraction,
    targetTotal: overallTotal * target.fraction,
    levers,
  };
}

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** The block handed to the model. Plain arithmetic, with its assumptions attached. */
export function describeScenarios(s: ScenarioResult): string {
  const lines: string[] = ["TARGET ARITHMETIC (calculated by Nixara - copy these figures, do not recompute)"];
  lines.push(
    `  The question asks to ${s.target.direction} ${s.metric} by ${(s.target.fraction * 100).toFixed(0)}%. ` +
      `Across ${s.rows.toLocaleString()} rows the total is ${money(s.overallTotal)} and the average per row is ${money(s.overallMean)}.`
  );
  lines.push(
    `  The target is ${money(s.targetTotal)} in total, or ${money(s.targetPerRow)} per row.`
  );

  if (s.levers.length === 0) {
    lines.push(
      `  No group in this file differs enough to size a saving from. State that the target ` +
        `cannot be reached by targeting any single group here, and say what would be needed instead.`
    );
    return lines.join("\n");
  }

  lines.push(
    `  If each gap below were closed completely, this is what it would be worth. ` +
      `These are ceilings, not forecasts: each assumes the whole gap is removed AND that the ` +
      `grouping causes it. Report them as "up to", and never add two together, because the ` +
      `same rows appear in both.`
  );
  for (const l of s.levers.slice(0, 5)) {
    lines.push(
      `  ${l.label}: moving ${l.worse} (${(l.affectedShare * 100).toFixed(1)}% of rows) to the ` +
        `${l.better} level closes ${money(l.gapPerRow)} per affected row, worth up to ` +
        `${money(l.valuePerRow)} per row overall, ${(l.shareOfTotal * 100).toFixed(1)}% of the total ` +
        `and ${(l.coverOfTarget * 100).toFixed(0)}% of the stated target.`
    );
  }
  const best = s.levers[0];
  if (best.coverOfTarget < 1) {
    lines.push(
      `  The single best lever covers ${(best.coverOfTarget * 100).toFixed(0)}% of the target, ` +
        `so no one change in this file reaches it on its own. Say so.`
    );
  }
  return lines.join("\n");
}
