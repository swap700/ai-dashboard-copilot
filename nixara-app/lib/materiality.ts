/**
 * Is the difference between these groups big enough to act on?
 *
 * Nothing in the engine ever asked this. buildDataSummary sorted each
 * breakdown and handed the model the list, and a sorted list always has a
 * top, so the model always found a "risk". Measured on a real 55,500-row
 * healthcare file:
 *
 *   Insurance Provider  5 groups  top = 20.26%  even split = 20.00%  excess +0.26pp
 *   Medical Condition   6 groups  top = 16.83%  even split = 16.67%  excess +0.16pp
 *   Admission Type      3 groups  top = 33.70%  even split = 33.33%  excess +0.36pp
 *
 * Every dimension was within 0.36 points of perfectly even, and nothing in
 * the file correlated with billing at all. Nixara reported "Cigna has the
 * highest total billing amount" as the number one risk at Impact: High. A
 * COO acting on that would spend a quarter chasing a rounding error.
 *
 * Three tests, all of them pure arithmetic on the data and none of them
 * depending on what the columns are called:
 *
 *   gap to runner-up   is first meaningfully ahead of second, or a photo finish
 *   share vs even      how far the top group sits above an equal split
 *   between vs within  how the spread BETWEEN group averages compares to the
 *                      spread of individual rows. This is the real test. If
 *                      groups differ by far less than rows differ from each
 *                      other, the grouping explains nothing, whatever the
 *                      totals look like.
 *
 * The last one is eta squared: the share of total variation the grouping
 * accounts for. A value near zero means knowing a row's group tells you
 * nothing about its value.
 */

import type { Dataset } from "./data-analysis";

export type MaterialityVerdict = "clear" | "weak" | "tied";

export interface GroupComparison {
  label: string;
  metric: string;
  agg: "mean" | "sum";
  groups: { key: string; total: number; mean: number; rows: number; share: number }[];
  topByTotal: string;
  topByAverage: string;
  /** True when the biggest group by total is NOT the biggest by average. */
  measureDisagrees: boolean;
  /** The top group's share of the metric, minus an equal split, in points. */
  excessOverEven: number;
  /** First place's lead over second, as a share of second. */
  gapToRunnerUp: number;
  /** Share of total variation explained by the grouping, 0 to 1. */
  varianceExplained: number;
  verdict: MaterialityVerdict;
}

/**
 * Thresholds. Deliberately loose: the job is to catch a photo finish being
 * sold as a winner, not to run a significance test the user did not ask for.
 */
const TIED_VARIANCE = 0.01; // the grouping explains under 1% of the spread
const TIED_GAP = 0.02; // first beats second by under 2%
const WEAK_VARIANCE = 0.05;

export function compareGroups(
  dataset: Dataset,
  label: string,
  metric: string,
  agg: "mean" | "sum"
): GroupComparison | null {
  const buckets = new Map<string, number[]>();
  const all: number[] = [];
  for (const row of dataset.rows) {
    const k = row[label];
    const v = row[metric];
    if (typeof v !== "number") continue;
    if (k === null || k === undefined || k === "") continue;
    const key = String(k);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(v);
    all.push(v);
  }
  if (buckets.size < 2 || all.length < 10) return null;

  const grandTotal = all.reduce((a, b) => a + b, 0);
  const grandMean = grandTotal / all.length;

  const groups = [...buckets.entries()].map(([key, vals]) => {
    const total = vals.reduce((a, b) => a + b, 0);
    return {
      key,
      total,
      mean: total / vals.length,
      rows: vals.length,
      share: grandTotal === 0 ? 0 : total / grandTotal,
    };
  });

  // eta squared: between-group spread over total spread. Scale-free, so it
  // behaves the same on dollars, minutes or counts.
  let between = 0;
  let within = 0;
  for (const g of groups) {
    const vals = buckets.get(g.key)!;
    between += vals.length * (g.mean - grandMean) ** 2;
    for (const v of vals) within += (v - g.mean) ** 2;
  }
  const totalVar = between + within;
  const varianceExplained = totalVar === 0 ? 0 : between / totalVar;

  const byTotal = [...groups].sort((a, b) => b.total - a.total);
  const byMean = [...groups].sort((a, b) => b.mean - a.mean);

  // The gap is ALWAYS measured per row, never on totals, however the metric
  // is aggregated. A total is driven by how many rows a group has: on a real
  // file, non-smokers led smokers by 305% on total income purely because
  // there are four times as many of them, and an earlier draft of this
  // called that a clear difference. Group size is a fact about the file, not
  // a difference in the thing being measured.
  const first = byMean[0].mean;
  const second = byMean[1].mean;
  const gapToRunnerUp = second === 0 ? Infinity : Math.abs(first - second) / Math.abs(second);
  const excessOverEven = (byTotal[0].share - 1 / groups.length) * 100;

  // Variance explained is the authority, and the only one of the three that
  // is both scale-free and immune to uneven group sizes. The gap is colour.
  //
  // An earlier draft let the gap veto, which broke on an ordered scale:
  // chronic_diseases ran 0 to 5 and explained 14.2% of the variation in
  // cost, the second strongest driver in the file, but adjacent levels sit
  // 7% apart so the gap test called it weak. Steps on a scale are close to
  // each other by definition; that says nothing about whether the scale
  // matters. The gap keeps one job: a photo finish at the top is worth
  // flagging even when the grouping as a whole explains something.
  let verdict: MaterialityVerdict;
  if (varianceExplained < TIED_VARIANCE || gapToRunnerUp < TIED_GAP) verdict = "tied";
  else if (varianceExplained < WEAK_VARIANCE) verdict = "weak";
  else verdict = "clear";

  return {
    label,
    metric,
    agg,
    groups: byTotal,
    topByTotal: byTotal[0].key,
    topByAverage: byMean[0].key,
    measureDisagrees: byTotal[0].key !== byMean[0].key,
    excessOverEven,
    gapToRunnerUp,
    varianceExplained,
    verdict,
  };
}

/**
 * The sentence the model is given in place of a ranking it would misread.
 *
 * Written as a finding rather than a caveat. "No meaningful difference" IS
 * the answer to "which should we target", and it is a more useful answer
 * than a name picked out of noise.
 */
export function describeMateriality(c: GroupComparison): string {
  const pct = (n: number) => {
    const v = n * 100;
    return `${v > 0 && v < 0.1 ? "<0.1" : v.toFixed(1)}%`;
  };
  const n = c.groups.length;

  if (c.verdict === "tied") {
    return (
      `NO MEANINGFUL DIFFERENCE between ${c.label} groups for ${c.metric}. ` +
      `All ${n} groups sit between ${pct(Math.min(...c.groups.map((g) => g.share)))} and ` +
      `${pct(Math.max(...c.groups.map((g) => g.share)))} of the total against an even split of ` +
      `${pct(1 / n)}, the leader is only ${pct(c.gapToRunnerUp)} ahead of second place, and ` +
      `${c.label} explains ${pct(c.varianceExplained)} of the variation in ${c.metric}. ` +
      `Do NOT name a single ${c.label} as a target or a top risk on this evidence: ` +
      `on this measure they are effectively the same.`
    );
  }
  if (c.verdict === "weak") {
    return (
      `WEAK DIFFERENCE between ${c.label} groups for ${c.metric}: the leader is ` +
      `${pct(c.gapToRunnerUp)} ahead of second and ${c.label} explains ${pct(c.varianceExplained)} ` +
      `of the variation. Report the ranking only with that caveat stated.`
    );
  }
  // The per-row leader, always, because both figures in this sentence are
  // per row: gapToRunnerUp is the gap between group MEANS and variance
  // explained is computed across rows. Naming the leader by total put the
  // wrong name on them -- "No leads smoker by 89.2%" on a file where Yes is
  // 89.2% higher per row and No is only bigger because there are four times
  // as many of them. Which group is biggest by total is a different fact,
  // and describeMeasureDisagreement below is where it belongs.
  return (
    `CLEAR DIFFERENCE: ${c.topByAverage} leads ${c.label} by ${pct(c.gapToRunnerUp)} per row over ` +
    `second place, and ${c.label} explains ${pct(c.varianceExplained)} of the variation in ${c.metric}.`
  );
}

/** The warning for a breakdown where the biggest by total is not the biggest by average. */
export function describeMeasureDisagreement(c: GroupComparison): string | null {
  if (!c.measureDisagrees) return null;
  const byTotal = c.groups[0];
  const byMean = [...c.groups].sort((a, b) => b.mean - a.mean)[0];
  return (
    `CAUTION on ${c.label}: ${byTotal.key} is largest by TOTAL ${c.metric} ` +
    `(${byTotal.rows.toLocaleString()} rows) but ${byMean.key} is highest per row ` +
    `(${byMean.mean.toFixed(2)} against ${byTotal.mean.toFixed(2)}). ` +
    `${byTotal.key} is bigger mainly because it has more rows, not because each one costs more. ` +
    `Say which of the two you mean.`
  );
}
