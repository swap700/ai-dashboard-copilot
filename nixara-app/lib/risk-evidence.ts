/**
 * The figures a risk has to be built out of.
 *
 * A risk report asked the model for "Likelihood: High / Medium / Low" and
 * "Impact: High / Medium / Low". Nothing in the data summary supported either
 * word, so the model supplied them from nowhere, and the top risk on a real
 * healthcare file came out as "Cigna has the highest total billing amount" --
 * rated High/High on a file where the five insurers sat within 0.3 points of
 * an even split. The rating was not wrong because the model was careless. It
 * was wrong because it was asked for a judgement it had no inputs for.
 *
 * So the ratings are gone and these three measurements take their place:
 *
 *   CONCENTRATION  does a small number of groups carry a disproportionate
 *                  share of the metric? This is the only thing that makes
 *                  "concentration risk" a real finding rather than a
 *                  restatement of the fact that a sorted list has a top.
 *   DIRECTION      is the metric rising or falling over time, and is the last
 *                  period complete? A report that compares a half-finished
 *                  month against full ones invents a collapse.
 *   INTEGRITY      duplicates and negative amounts, priced in the metric's
 *                  own units, so "534 duplicate rows" becomes "$1.2m of
 *                  billing counted twice".
 *
 * Every number here is arithmetic on the file. None of them is a rating.
 */

import { MIN_COLUMNS_FOR_DUPLICATE_CHECK, type Dataset } from "./data-analysis";

export interface Concentration {
  column: string;
  levels: number;
  topLevel: string;
  /** Share of the metric total carried by the top level, 0 to 1. */
  topShare: number;
  /** Share carried by the top five levels, 0 to 1. */
  topFiveShare: number;
  /** What each level would carry if the metric were spread evenly. */
  evenShare: number;
  /** True only when a few groups really do carry a disproportionate share. */
  concentrated: boolean;
}

export interface Direction {
  dateColumn: string;
  metric: string;
  periods: number;
  firstPeriod: string;
  lastPeriod: string;
  firstValue: number;
  lastValue: number;
  /** Change from the first complete period to the last, as a fraction. */
  change: number;
  trend: "rising" | "falling" | "flat";
  /**
   * The last period holds far fewer rows than the ones before it, so it is
   * almost certainly still being filled.
   */
  lastPeriodPartial: boolean;
  lastPeriodRows: number;
  typicalPeriodRows: number;
}

export interface IntegrityExposure {
  duplicateRows: number;
  duplicateValue: number;
  negativeRows: number;
  negativeValue: number;
  metric: string;
  total: number;
}

export interface RiskEvidence {
  metric: string;
  concentration: Concentration[];
  direction: Direction | null;
  integrity: IntegrityExposure | null;
}

/**
 * Top level carries at least a quarter of the metric AND at least twice what
 * an even split would give it. Both halves are needed: a quarter across four
 * groups is an even split, and twice an even split across fifty groups is 4%.
 */
const CONCENTRATED_TOP_SHARE = 0.25;
const CONCENTRATED_MULTIPLE = 2;
/** Or the classic version: a handful of groups carry most of it. */
const CONCENTRATED_TOP_FIVE = 0.6;
const MIN_LEVELS_FOR_TOP_FIVE = 10;
/** A last period under this share of a typical one is treated as unfinished. */
const PARTIAL_PERIOD_RATIO = 0.6;

function totalsByLevel(dataset: Dataset, column: string, metric: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of dataset.rows) {
    const v = row[metric];
    const k = row[column];
    if (typeof v !== "number" || k === null || k === undefined || k === "") continue;
    const key = String(k);
    out.set(key, (out.get(key) ?? 0) + v);
  }
  return out;
}

export function measureConcentration(dataset: Dataset, column: string, metric: string): Concentration | null {
  const totals = totalsByLevel(dataset, column, metric);
  if (totals.size < 2) return null;
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const grand = entries.reduce((s, [, v]) => s + v, 0);
  // Shares only mean anything when the parts add to the whole. With negative
  // amounts in the column a "share" can exceed 100% or flip sign.
  if (grand <= 0 || entries.some(([, v]) => v < 0)) return null;
  const topShare = entries[0][1] / grand;
  const topFiveShare = entries.slice(0, 5).reduce((s, [, v]) => s + v, 0) / grand;
  const evenShare = 1 / entries.length;
  const concentrated =
    (topShare >= CONCENTRATED_TOP_SHARE && topShare >= evenShare * CONCENTRATED_MULTIPLE) ||
    (entries.length >= MIN_LEVELS_FOR_TOP_FIVE && topFiveShare >= CONCENTRATED_TOP_FIVE);
  return {
    column,
    levels: entries.length,
    topLevel: entries[0][0],
    topShare,
    topFiveShare,
    evenShare,
    concentrated,
  };
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function measureDirection(dataset: Dataset, dateColumn: string, metric: string): Direction | null {
  const buckets = new Map<string, { sum: number; rows: number }>();
  for (const row of dataset.rows) {
    const d = row[dateColumn];
    const v = row[metric];
    if (!(d instanceof Date) || Number.isNaN(d.getTime()) || typeof v !== "number") continue;
    const key = monthKey(d);
    const b = buckets.get(key) ?? { sum: 0, rows: 0 };
    b.sum += v;
    b.rows += 1;
    buckets.set(key, b);
  }
  if (buckets.size < 3) return null;
  const ordered = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const rowCounts = ordered.map(([, b]) => b.rows);
  const sortedCounts = [...rowCounts].sort((a, b) => a - b);
  const median = sortedCounts[Math.floor(sortedCounts.length / 2)];
  const lastRows = rowCounts[rowCounts.length - 1];
  const lastPeriodPartial = lastRows < median * PARTIAL_PERIOD_RATIO;

  // A partial last period is excluded from the comparison rather than used
  // and apologised for. A half-filled month against full ones reads as a 50%
  // collapse, and a caveat underneath does not undo the headline.
  const usable = lastPeriodPartial ? ordered.slice(0, -1) : ordered;
  if (usable.length < 2) return null;
  const first = usable[0];
  const last = usable[usable.length - 1];
  const change = first[1].sum === 0 ? 0 : (last[1].sum - first[1].sum) / Math.abs(first[1].sum);
  return {
    dateColumn,
    metric,
    periods: usable.length,
    firstPeriod: first[0],
    lastPeriod: last[0],
    firstValue: first[1].sum,
    lastValue: last[1].sum,
    change,
    trend: Math.abs(change) < 0.05 ? "flat" : change > 0 ? "rising" : "falling",
    lastPeriodPartial,
    lastPeriodRows: lastRows,
    typicalPeriodRows: median,
  };
}

export function measureIntegrity(dataset: Dataset, metric: string): IntegrityExposure | null {
  let total = 0;
  let negativeRows = 0;
  let negativeValue = 0;
  for (const row of dataset.rows) {
    const v = row[metric];
    if (typeof v !== "number") continue;
    total += v;
    if (v < 0) {
      negativeRows += 1;
      negativeValue += v;
    }
  }

  // Exact repeats across every column. The value at stake is the metric on
  // the repeats beyond the first, because that is what a total double counts.
  //
  // Gated on column count, with the same constant the quality score uses. On
  // a narrow file an exact full-row match is an ordinary coincidence, and
  // without the gate this block would have reported "double counting" on
  // files the score correctly left alone.
  const seen = new Map<string, number>();
  let duplicateRows = 0;
  let duplicateValue = 0;
  const duplicateCheckRows =
    dataset.columns.length >= MIN_COLUMNS_FOR_DUPLICATE_CHECK ? dataset.rows : [];
  for (const row of duplicateCheckRows) {
    const key = dataset.columns.map((c) => String(row[c] ?? "")).join("\u0001");
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n > 0) {
      duplicateRows += 1;
      const v = row[metric];
      if (typeof v === "number") duplicateValue += v;
    }
  }
  if (duplicateRows === 0 && negativeRows === 0) return null;
  return { duplicateRows, duplicateValue, negativeRows, negativeValue, metric, total };
}

export function collectRiskEvidence(
  dataset: Dataset,
  metric: string,
  labelColumns: string[],
  dateColumns: string[]
): RiskEvidence | null {
  if (!metric) return null;
  const concentration = labelColumns
    .map((c) => measureConcentration(dataset, c, metric))
    .filter((c): c is Concentration => c !== null)
    // Most concentrated first, so the real finding is at the top of the block.
    .sort((a, b) => b.topShare / b.evenShare - a.topShare / a.evenShare)
    .slice(0, 6);
  let direction: Direction | null = null;
  for (const d of dateColumns) {
    direction = measureDirection(dataset, d, metric);
    if (direction) break;
  }
  const integrity = measureIntegrity(dataset, metric);
  if (concentration.length === 0 && !direction && !integrity) return null;
  return { metric, concentration, direction, integrity };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const money = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function describeRiskEvidence(e: RiskEvidence): string {
  const lines = [
    "RISK EVIDENCE (calculated by Nixara - a risk must be built from one of these figures, and the exposure figure must be copied, not estimated)",
  ];

  for (const c of e.concentration) {
    if (c.concentrated) {
      lines.push(
        `  CONCENTRATED: ${c.topLevel} carries ${pct(c.topShare)} of total ${e.metric} across ` +
          `${c.levels} ${c.column} values, against ${pct(c.evenShare)} for an even split. ` +
          `Top five carry ${pct(c.topFiveShare)}. Exposure if this group is lost or repriced: ${pct(c.topShare)} of ${e.metric}.`
      );
    } else {
      lines.push(
        `  SPREAD: ${c.column} is not concentrated. Its largest value, ${c.topLevel}, carries ` +
          `${pct(c.topShare)} of total ${e.metric} against ${pct(c.evenShare)} for an even split. ` +
          `Being top of this list is NOT a risk and must not be reported as one.`
      );
    }
  }

  if (e.direction) {
    const d = e.direction;
    lines.push(
      `  DIRECTION: total ${d.metric} is ${d.trend} across ${d.periods} periods of ${d.dateColumn}, ` +
        `from ${money(d.firstValue)} in ${d.firstPeriod} to ${money(d.lastValue)} in ${d.lastPeriod} ` +
        `(${d.change >= 0 ? "+" : ""}${pct(d.change)}).`
    );
    if (d.lastPeriodPartial) {
      lines.push(
        `  PARTIAL PERIOD: the latest period holds only ${d.lastPeriodRows} rows against a typical ` +
          `${d.typicalPeriodRows}, so it is still being filled. It is EXCLUDED from the figures above. ` +
          `Do not compare it against a full period and do not report it as a fall.`
      );
    }
  } else {
    lines.push(
      `  NO DIRECTION AVAILABLE: this file has no usable dates, so nothing here shows whether ` +
        `anything is getting better or worse. Do not describe any figure as rising, falling, ` +
        `worsening, deteriorating or a trend.`
    );
  }

  if (e.integrity) {
    const i = e.integrity;
    if (i.duplicateRows > 0) {
      lines.push(
        `  DOUBLE COUNTING: ${i.duplicateRows.toLocaleString()} rows are exact repeats, carrying ` +
          `${money(i.duplicateValue)} of ${i.metric} (${pct(i.total === 0 ? 0 : i.duplicateValue / i.total)} of the total). ` +
          `Every total in this report includes them.`
      );
    }
    if (i.negativeRows > 0) {
      lines.push(
        `  NEGATIVE AMOUNTS: ${i.negativeRows.toLocaleString()} rows hold a negative ${i.metric}, ` +
          `totalling ${money(i.negativeValue)}. Either refunds that belong in the figures or errors that do not.`
      );
    }
  }

  lines.push(
    `  Anything you want to say that is not traceable to a figure in this summary must be ` +
      `written as "assumption, not from your data". If a risk cannot be traced to one, drop it ` +
      `and report fewer risks.`
  );
  return lines.join("\n");
}
