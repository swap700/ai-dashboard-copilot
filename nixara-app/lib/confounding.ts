/**
 * Does the difference survive when you hold the other things steady?
 *
 * A user asked, in as many words: "Say which differences might be caused by
 * age, BMI or plan mix, and what we cannot conclude from this data." The
 * report said nothing about any of it, because nothing in the engine could.
 * It compared groups one dimension at a time and had no way to ask whether
 * the gap it found was the thing named or something travelling with it.
 *
 * That question is the whole difference between a reporting tool and an
 * analysis tool. "Smokers cost 92% more" is a fact about two columns.
 * "Smokers cost 92% more, and they are the same age, BMI and plan mix as
 * non-smokers, so it is not those" is a finding someone can price.
 *
 * Two things are computed, both ordinary arithmetic:
 *
 *   BALANCE     for each candidate confounder, how far apart the groups are
 *               on it, scaled by how much that confounder varies overall
 *               (a standardised difference). Near zero means the groups are
 *               alike on it, so it cannot be the explanation.
 *   ADJUSTMENT  least squares with the grouping plus every confounder, so
 *               the grouping's coefficient is its effect with the others
 *               held still. Compared against the raw gap, this says how
 *               much of the gap the other columns account for.
 *
 * What it deliberately does NOT do is claim causation. Adjustment removes
 * the confounders you hand it and nothing else, and an observational file
 * always has others. The output says that in words, because the honest
 * limit of this method is part of its result.
 */

import type { Dataset } from "./data-analysis";

export interface BalanceCheck {
  column: string;
  /**
   * "numeric" compares means. "share" compares the share of rows sitting in
   * one level of a categorical confounder, which is how a plan mix or a
   * region mix gets checked: "42% of smokers are on Bronze against 41% of
   * non-smokers" is the same question as "are they the same age".
   */
  kind: "numeric" | "share";
  /** For a share check, the level being compared. */
  level?: string;
  /** Mean of this confounder in the high group and the low group. */
  highGroupMean: number;
  lowGroupMean: number;
  /** Difference in standard deviations. Under 0.1 is conventionally balanced. */
  standardisedDifference: number;
  balanced: boolean;
}

export interface ConfoundingResult {
  metric: string;
  group: string;
  highGroup: string;
  lowGroup: string;
  rawGap: number;
  /** Standard error of the raw gap, from the two groups' own spreads. */
  rawGapSe: number;
  adjustedGap: number;
  /** Standard error of the adjusted gap, from the regression. */
  adjustedGapSe: number;
  /** 95% interval around the adjusted gap. */
  adjustedGapLow: number;
  adjustedGapHigh: number;
  /**
   * Whether that interval excludes zero. This is the only basis on which the
   * output may say a difference "holds up": a point estimate cannot say it.
   */
  distinguishableFromZero: boolean;
  /** Rows minus columns in the fit. */
  dof: number;
  /** Share of the raw gap the confounders account for, 0 to 1. */
  explainedAway: number;
  /** Numeric confounders held steady in the adjustment. */
  confounders: string[];
  /** Categorical confounders held steady, each dummy-coded. */
  categoricalConfounders: string[];
  /**
   * Every column checked for balance, including ones left out of the
   * adjustment. A column can be reported as "the groups are alike on this"
   * without being in the regression.
   */
  balance: BalanceCheck[];
  /** Columns checked for balance but not adjusted for, because the adjustment is capped. */
  checkedOnly: string[];
  /**
   * Confounders the grouping strongly predicts, which is the shape of a
   * CONSEQUENCE rather than a competing explanation.
   *
   * Smoking makes people sicker, sicker people see the doctor more, more
   * visits cost more. Doctor visits are a step on smoking's own path to cost,
   * not a rival explanation for it, so holding them steady throws away part
   * of smoking's effect and the adjusted figure comes out too small. Nixara
   * cannot tell a cause from a consequence from the data - age-causes-smoking
   * and smoking-causes-visits look identical to a correlation - so it names
   * the candidates and reports the gap BOTH ways instead of picking one.
   */
  mediatorCandidates: string[];
  /** The adjusted gap with the mediator candidates left out of the fit. */
  adjustedGapExcludingMediators: number | null;
  /** Columns the USER marked as consequences. Excluded from the fit outright. */
  excludedByUser: string[];
  rows: number;
}

/**
 * The result of a least squares fit: coefficients AND how much each one could
 * move if you had sampled different rows.
 *
 * The first version returned coefficients alone. That is one number with no
 * margin around it, and the output was still willing to say "the difference
 * holds up" on the strength of it. A political poll reporting "52% support"
 * without "plus or minus 3 points" is the same mistake: 52 plus or minus 3 is
 * a real lead and 52 plus or minus 9 is a coin flip, and the headline figure
 * cannot tell you which you have. On one test file an adjusted gap came out
 * at 0.7 from a raw 6,000, and nothing in the output could distinguish a true
 * zero from a number Nixara simply could not pin down.
 */
interface Regression {
  /** One coefficient per column of X. */
  beta: number[];
  /** Standard error of each coefficient. */
  se: number[];
  /** Rows minus columns: how much information is left after the fit. */
  dof: number;
  /** Residual standard deviation, in the metric's own units. */
  residualStd: number;
}

/** 95% two-sided, from the normal approximation. */
const Z_95 = 1.959964;

/**
 * Solves (X'X)b = X'y and inverts (X'X) in the same pass, by Gauss-Jordan on
 * the augmented matrix [X'X | X'y | I]. The inverse is what standard errors
 * need: se_j = sqrt(s2 * inv(X'X)_jj), where s2 is the residual variance.
 */
function leastSquares(X: number[][], y: number[]): Regression | null {
  const n = X[0].length;
  const rows = X.length;
  const dof = rows - n;
  // Without spare rows there is nothing left to estimate the spread from, so
  // a standard error would be undefined or absurdly wide.
  if (dof < 10) return null;

  const xtx: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const xty = new Array<number>(n).fill(0);
  for (let r = 0; r < rows; r++) {
    const row = X[r];
    for (let i = 0; i < n; i++) {
      xty[i] += row[i] * y[r];
      for (let j = i; j < n; j++) xtx[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) xtx[i][j] = xtx[j][i];

  // A small ridge term, scaled to the matrix, so a confounder that is
  // perfectly collinear with the grouping cannot produce a singular matrix
  // and a NaN coefficient. Scaled rather than fixed: 1e-8 against a diagonal
  // of 1e12 is not a regulariser, it is a rounding error.
  const scale = Math.max(...xtx.map((row, i) => Math.abs(row[i]))) || 1;
  for (let i = 0; i < n; i++) xtx[i][i] += scale * 1e-10;

  // [X'X | X'y | I], width 2n + 1.
  const aug = xtx.map((row, i) => {
    const identity = new Array<number>(n).fill(0);
    identity[i] = 1;
    return [...row, xty[i], ...identity];
  });
  const width = 2 * n + 1;

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    }
    if (Math.abs(aug[pivot][col]) < 1e-12) return null;
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    const p = aug[col][col];
    for (let c = col; c < width; c++) aug[col][c] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = aug[r][col];
      if (f === 0) continue;
      for (let c = col; c < width; c++) aug[r][c] -= f * aug[col][c];
    }
  }

  const beta = aug.map((row) => row[n]);
  if (!beta.every((b) => Number.isFinite(b))) return null;

  // Residual sum of squares, then the variance per degree of freedom.
  let rss = 0;
  for (let r = 0; r < rows; r++) {
    let fitted = 0;
    for (let i = 0; i < n; i++) fitted += X[r][i] * beta[i];
    rss += (y[r] - fitted) ** 2;
  }
  const s2 = rss / dof;
  const se = aug.map((row, i) => {
    const v = s2 * row[n + 1 + i];
    return v > 0 ? Math.sqrt(v) : 0;
  });
  if (!se.every((v) => Number.isFinite(v))) return null;

  return { beta, se, dof, residualStd: Math.sqrt(s2) };
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

/**
 * Compares the two extreme groups of `group` on `metric`, adjusting for
 * every numeric column in `confounders`.
 *
 * Only the two extremes, because that is the comparison a reader acts on
 * ("smokers against non-smokers"), and because a multi-level adjustment
 * invites a reading of the coefficients that this output does not support.
 */
/**
 * How much a confounder could bias the gap, in one number.
 *
 * A column can only explain a group difference if it is associated with the
 * outcome AND distributed differently between the groups. Either one alone is
 * harmless: a column the groups differ wildly on but which does not move the
 * metric cannot shift anything, and neither can a strong predictor the groups
 * share equally. The product of the two is the bias term, so it is what ranks
 * candidates when the adjustment has to be capped.
 */
function biasPotential(assocWithOutcome: number, imbalance: number): number {
  return Math.abs(assocWithOutcome) * Math.abs(imbalance);
}

/** Correlation of a numeric column with the metric, over the rows in play. */
function corr(rows: Record<string, unknown>[], a: string, b: string): number {
  const pairs = rows
    .map((r) => [r[a], r[b]])
    .filter((p): p is [number, number] => typeof p[0] === "number" && typeof p[1] === "number");
  if (pairs.length < 3) return 0;
  const ma = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const mb = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (const [x, y] of pairs) {
    num += (x - ma) * (y - mb);
    da += (x - ma) ** 2;
    db += (y - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/** Share of the metric's variance a categorical column accounts for (eta squared). */
function etaSquared(rows: Record<string, unknown>[], col: string, metric: string): number {
  const groups = new Map<string, number[]>();
  const all: number[] = [];
  for (const r of rows) {
    const v = r[metric];
    const k = r[col];
    if (typeof v !== "number" || k === null || k === undefined || k === "") continue;
    const key = String(k);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
    all.push(v);
  }
  if (all.length < 3 || groups.size < 2) return 0;
  const grand = all.reduce((a, b) => a + b, 0) / all.length;
  const total = all.reduce((s, v) => s + (v - grand) ** 2, 0);
  if (total === 0) return 0;
  let between = 0;
  for (const vals of groups.values()) {
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    between += vals.length * (m - grand) ** 2;
  }
  return between / total;
}

/**
 * At most this many columns go into the adjustment. Not an arbitrary round
 * number: every extra column costs degrees of freedom and raises the chance
 * that one of them is a consequence of the grouping rather than a cause of
 * the gap, which drags the adjusted figure down for the wrong reason. Past
 * the handful that carry real bias, the rest only add noise and make the
 * sentence unreadable.
 */
const MAX_ADJUSTED = 8;
/** Balanced columns named in the prose before it collapses to a count. */
const MAX_NAMED_BALANCED = 5;
/**
 * A standardised difference this large means the grouping all but determines
 * the column, which is what a consequence looks like from the data's side. A
 * genuine confounder is usually mildly imbalanced; a mediator is lopsided.
 * Half a standard deviation is the conventional line for "a large imbalance",
 * so it is the line used here rather than one invented for this purpose.
 */
const MEDIATOR_IMBALANCE = 0.8;
/**
 * And the two fits have to actually disagree before it is worth a paragraph.
 * On one real file the with-and-without figures were 14,711 and 14,867, a 1%
 * difference, and reporting that as a caveat is noise dressed as rigour.
 */
const MEDIATOR_MATERIAL_SHIFT = 0.1;

export function checkConfounding(
  dataset: Dataset,
  metric: string,
  group: string,
  confounders: string[],
  categoricalConfounders: string[] = [],
  /**
   * Columns the user has marked as consequences of the grouping. Dropped from
   * the adjustment entirely, because the user knows something the data does
   * not contain. Nixara never infers this set; it only ever suggests
   * candidates (see mediatorCandidates).
   */
  userMarkedConsequences: string[] = []
): ConfoundingResult | null {
  const excluded = new Set(userMarkedConsequences);
  const numericCandidates = [...new Set(confounders)].filter(
    (c) => c !== metric && c !== group && !excluded.has(c)
  );
  const buckets = new Map<string, number[]>();
  for (const row of dataset.rows) {
    const v = row[metric];
    const k = row[group];
    if (typeof v !== "number" || k === null || k === undefined || k === "") continue;
    const key = String(k);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(v);
  }
  if (buckets.size < 2) return null;

  const means = [...buckets.entries()]
    .map(([key, vals]) => ({ key, mean: vals.reduce((a, b) => a + b, 0) / vals.length }))
    .sort((a, b) => b.mean - a.mean);
  const highGroup = means[0].key;
  const lowGroup = means[means.length - 1].key;
  const rawGap = means[0].mean - means[means.length - 1].mean;
  if (rawGap === 0) return null;

  // A column that is already a numeric confounder is not dummy-coded as well.
  // Without this, an ordered count like chronic_diseases arrived twice -- once
  // as a number and once as a category -- and was named twice in the output.
  const catCandidates = new Map<string, string[]>();
  for (const c of [...new Set(categoricalConfounders)]) {
    if (c === metric || c === group || numericCandidates.includes(c) || excluded.has(c)) continue;
    const levels = new Set<string>();
    for (const r of dataset.rows) {
      const v = r[c];
      if (v === null || v === undefined || v === "") continue;
      levels.add(String(v));
    }
    if (levels.size >= 2 && levels.size <= 12) catCandidates.set(c, [...levels].sort());
  }

  // Rows in either extreme group with every candidate present.
  const rows = dataset.rows.filter((r) => {
    const k = String(r[group] ?? "");
    if (k !== highGroup && k !== lowGroup) return false;
    if (typeof r[metric] !== "number") return false;
    if (!numericCandidates.every((c) => typeof r[c] === "number")) return false;
    return [...catCandidates.keys()].every((c) => {
      const v = r[c];
      return v !== null && v !== undefined && v !== "" && catCandidates.get(c)!.includes(String(v));
    });
  });
  if (rows.length < 30) return null;

  const hiRows = rows.filter((r) => String(r[group]) === highGroup);
  const loRows = rows.filter((r) => String(r[group]) === lowGroup);
  if (hiRows.length < 5 || loRows.length < 5) return null;

  // ── Balance, for every candidate ─────────────────────────────────────────
  const ranked: { check: BalanceCheck; bias: number; levels?: string[] }[] = [];

  for (const c of numericCandidates) {
    const hi = hiRows.map((r) => r[c] as number);
    const lo = loRows.map((r) => r[c] as number);
    const hiMean = hi.reduce((a, b) => a + b, 0) / hi.length;
    const loMean = lo.reduce((a, b) => a + b, 0) / lo.length;
    const pooled = Math.sqrt((std(hi) ** 2 + std(lo) ** 2) / 2);
    const d = pooled === 0 ? 0 : Math.abs(hiMean - loMean) / pooled;
    ranked.push({
      check: {
        column: c,
        kind: "numeric",
        highGroupMean: hiMean,
        lowGroupMean: loMean,
        standardisedDifference: d,
        balanced: d < 0.1,
      },
      bias: biasPotential(corr(rows, c, metric), d),
    });
  }

  // For a categorical confounder, the balance check is on the level whose
  // share differs most between the groups. That is the level that could
  // carry the gap, so it is the one worth reporting.
  for (const [c, levels] of catCandidates) {
    let worst: BalanceCheck | null = null;
    for (const level of levels) {
      const hiShare = hiRows.filter((r) => String(r[c]) === level).length / hiRows.length;
      const loShare = loRows.filter((r) => String(r[c]) === level).length / loRows.length;
      // The standardised difference for two proportions.
      const pooled = Math.sqrt((hiShare * (1 - hiShare) + loShare * (1 - loShare)) / 2);
      const d = pooled === 0 ? 0 : Math.abs(hiShare - loShare) / pooled;
      if (!worst || d > worst.standardisedDifference) {
        worst = {
          column: c,
          kind: "share",
          level,
          highGroupMean: hiShare * 100,
          lowGroupMean: loShare * 100,
          standardisedDifference: d,
          balanced: d < 0.1,
        };
      }
    }
    if (worst) {
      // eta squared is on the same 0-1 footing as a squared correlation, so
      // rooting it puts a category's association with the outcome on the
      // same scale as a numeric column's.
      ranked.push({
        check: worst,
        bias: biasPotential(Math.sqrt(etaSquared(rows, c, metric)), worst.standardisedDifference),
        levels,
      });
    }
  }
  if (ranked.length === 0) return null;

  // ── Which of them to actually adjust for ─────────────────────────────────
  // Highest bias potential first, but each dummy-coded category costs a
  // column per level, so the cap is on columns rather than on names.
  const sorted = [...ranked].sort((a, b) => b.bias - a.bias);
  const chosen: typeof sorted = [];
  let extraColumns = 0;
  for (const cand of sorted) {
    const cost = cand.levels ? cand.levels.length - 1 : 1;
    if (chosen.length >= MAX_ADJUSTED) break;
    // Least squares needs comfortably more rows than columns.
    if (rows.length < (2 + extraColumns + cost) * 10) continue;
    chosen.push(cand);
    extraColumns += cost;
  }
  if (chosen.length === 0) return null;

  const chosenNames = new Set(chosen.map((c) => c.check.column));
  const adjustNumeric = chosen.filter((c) => !c.levels).map((c) => c.check.column);
  const adjustCats = chosen.filter((c) => c.levels).map((c) => c.check.column);

  const X = rows.map((r) => {
    const dummies: number[] = [];
    for (const c of adjustCats) {
      // First level is the reference, so k-1 dummies and no collinearity
      // with the intercept.
      for (const level of catCandidates.get(c)!.slice(1)) dummies.push(String(r[c]) === level ? 1 : 0);
    }
    return [1, String(r[group]) === highGroup ? 1 : 0, ...adjustNumeric.map((c) => r[c] as number), ...dummies];
  });
  const y = rows.map((r) => r[metric] as number);
  const fit = leastSquares(X, y);
  if (!fit) return null;

  // Candidate consequences: chosen confounders the grouping all but
  // determines. If any, the fit is run a SECOND time without them, so the
  // reader gets both ends of the honest range instead of one number that may
  // be too small for a reason the output does not mention.
  const mediatorCandidates = chosen
    .filter((c) => c.check.standardisedDifference >= MEDIATOR_IMBALANCE)
    .map((c) => c.check.column);
  let adjustedGapExcludingMediators: number | null = null;
  if (mediatorCandidates.length > 0 && mediatorCandidates.length < chosen.length) {
    const keepNumeric = adjustNumeric.filter((c) => !mediatorCandidates.includes(c));
    const keepCats = adjustCats.filter((c) => !mediatorCandidates.includes(c));
    const X2 = rows.map((r) => {
      const dummies: number[] = [];
      for (const c of keepCats) {
        for (const level of catCandidates.get(c)!.slice(1)) dummies.push(String(r[c]) === level ? 1 : 0);
      }
      return [1, String(r[group]) === highGroup ? 1 : 0, ...keepNumeric.map((c) => r[c] as number), ...dummies];
    });
    const fit2 = leastSquares(X2, y);
    if (fit2) adjustedGapExcludingMediators = fit2.beta[1];
  }

  const adjustedGap = fit.beta[1];
  const adjustedGapSe = fit.se[1];
  const half = Z_95 * adjustedGapSe;

  // The raw gap's own standard error: the ordinary two-sample difference of
  // means. Reported because the raw gap is the headline figure, and it was
  // just as naked as the adjusted one.
  const hiVals = hiRows.map((r) => r[metric] as number);
  const loVals = loRows.map((r) => r[metric] as number);
  const rawGapSe = Math.sqrt(
    std(hiVals) ** 2 / hiVals.length + std(loVals) ** 2 / loVals.length
  );

  return {
    metric,
    group,
    highGroup,
    lowGroup,
    rawGap,
    rawGapSe,
    adjustedGap,
    adjustedGapSe,
    adjustedGapLow: adjustedGap - half,
    adjustedGapHigh: adjustedGap + half,
    distinguishableFromZero: Math.abs(adjustedGap) > half,
    dof: fit.dof,
    explainedAway: 1 - adjustedGap / rawGap,
    confounders: adjustNumeric,
    categoricalConfounders: adjustCats,
    balance: ranked.map((r) => r.check),
    checkedOnly: ranked.map((r) => r.check.column).filter((c) => !chosenNames.has(c)),
    mediatorCandidates,
    adjustedGapExcludingMediators,
    excludedByUser: [...excluded],
    rows: rows.length,
  };
}

const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

/**
 * The with-and-without range, or null when the distinction does not change
 * the answer. Exported so the UI panel and the summary apply one rule.
 */
export function mediatorShift(
  c: ConfoundingResult
): { low: number; high: number; relative: number } | null {
  if (c.mediatorCandidates.length === 0 || c.adjustedGapExcludingMediators === null) return null;
  const a = c.adjustedGap;
  const b = c.adjustedGapExcludingMediators;
  const relative = a === 0 ? Infinity : Math.abs(b - a) / Math.abs(a);
  if (relative < MEDIATOR_MATERIAL_SHIFT) return null;
  return { low: Math.min(a, b), high: Math.max(a, b), relative };
}

function listWithCap(names: string[], cap: number): string {
  if (names.length <= cap) return names.join(", ");
  const extra = names.length - cap;
  return `${names.slice(0, cap).join(", ")} and ${extra} other${extra === 1 ? "" : "s"}`;
}

export function describeConfounding(c: ConfoundingResult): string {
  const lines: string[] = [];
  const held = [...c.confounders, ...c.categoricalConfounders];
  const heldText = listWithCap(held, 6);
  const share = c.explainedAway;

  // The verdict rests on the INTERVAL, never on the point estimate. Saying a
  // difference "holds up" because two point estimates are close is a claim
  // about precision made without measuring precision. Where the interval
  // includes zero, nothing holds up: Nixara cannot tell the adjusted gap
  // from no gap at all, and that is the finding.
  let verdict: string;
  if (!c.distinguishableFromZero) {
    verdict =
      `cannot be told apart from no difference once ${heldText} are held steady: the adjusted ` +
      `figure is ${num(c.adjustedGap)} but its 95% range runs from ${num(c.adjustedGapLow)} to ` +
      `${num(c.adjustedGapHigh)}, which includes zero. Do NOT report this as a driver or size a ` +
      `saving from it`;
  } else if (Math.abs(share) < 0.1) {
    verdict = `holds up: adjusting for ${heldText} changes it by under 10%`;
  } else if (share > 0.5) {
    verdict = `is mostly explained by ${heldText}, not by ${c.group} itself`;
  } else if (share > 0) {
    verdict = `shrinks by ${(share * 100).toFixed(0)}% once ${heldText} are held steady`;
  } else {
    verdict =
      `grows by ${(-share * 100).toFixed(0)}% once ${heldText} are held steady, ` +
      `so those columns were masking part of it`;
  }

  lines.push(
    `  ${c.group}: ${c.highGroup} against ${c.lowGroup} on ${c.metric} is ${num(c.rawGap)} raw ` +
      `(give or take ${num(Z_95 * c.rawGapSe)}) and ${num(c.adjustedGap)} adjusted ` +
      `(95% range ${num(c.adjustedGapLow)} to ${num(c.adjustedGapHigh)}), across ` +
      `${c.rows.toLocaleString()} rows. The difference ${verdict}.`
  );
  lines.push(
    `    Quote the range, not the single adjusted figure: one number implies a precision ` +
      `${c.rows.toLocaleString()} rows do not support.`
  );

  const fmt = (b: BalanceCheck) =>
    b.kind === "share"
      ? `${b.column} (${b.level}: ${num(b.highGroupMean)}% against ${num(b.lowGroupMean)}%)`
      : `${b.column} (${num(b.highGroupMean)} against ${num(b.lowGroupMean)})`;

  // Imbalanced columns are the interesting ones, so they are all named. The
  // balanced list is the boring half and only needs to be long enough to be
  // convincing: an unbroken wall of sixteen column names was read as noise.
  const unbalanced = c.balance.filter((b) => !b.balanced).sort(
    (a, b) => b.standardisedDifference - a.standardisedDifference
  );
  const balanced = c.balance.filter((b) => b.balanced);
  if (balanced.length > 0) {
    const named = balanced.slice(0, MAX_NAMED_BALANCED).map(fmt);
    const extra = balanced.length - named.length;
    lines.push(
      `    The two groups are alike on ${named.join(", ")}` +
        (extra > 0 ? ` and ${extra} other column${extra === 1 ? "" : "s"}` : "") +
        `, so none of those can be the explanation.`
    );
  }
  for (const b of unbalanced.slice(0, 4)) {
    lines.push(
      `    They do differ on ${fmt(b)}, which is part of why the adjusted figure moves.`
    );
  }
  if (c.checkedOnly.length > 0) {
    lines.push(
      `    Checked for balance but not adjusted for: ${listWithCap(c.checkedOnly, 6)}. ` +
        `The adjustment is capped so it stays stable.`
    );
  }
  if (c.excludedByUser.length > 0) {
    lines.push(
      `    Left out because the user marked them as consequences of ${c.group}: ` +
        `${listWithCap(c.excludedByUser, 6)}.`
    );
  }
  const shift = mediatorShift(c);
  if (shift !== null) {
    lines.push(
      `    MAY BE CONSEQUENCES: ${listWithCap(c.mediatorCandidates, 3)}. ${c.group} all but determines ` +
        `them, so holding them steady may remove part of its own effect. Report ${num(shift.low)} to ` +
        `${num(shift.high)}, naming those columns.`
    );
  }
  return lines.join("\n");
}

/** The block for the summary, plus the limits of the method. */
export function describeConfoundingBlock(results: ConfoundingResult[]): string {
  if (results.length === 0) return "";
  const lines = ["CONTROLLED COMPARISON (calculated by Nixara - what survives when the others are held steady)"];
  for (const r of results) lines.push(describeConfounding(r));
  // Can the levers be RANKED? The user's question was "is smoking or chronic
  // disease the bigger cost driver", and a report that answers it by putting
  // the larger point estimate first is answering a question the data may not
  // settle. On the user's own file smoking adjusts to 13,844-14,139 and
  // chronic disease at its extreme to 12,781-16,641: the ranges overlap, so
  // the honest answer is that this file cannot order them.
  const rankable = results.filter((r) => r.distinguishableFromZero);
  if (rankable.length >= 2) {
    const byGap = [...rankable].sort((a, b) => Math.abs(b.adjustedGap) - Math.abs(a.adjustedGap));
    const overlapping: string[] = [];
    for (let i = 0; i < byGap.length - 1; i++) {
      const a = byGap[i];
      const b = byGap[i + 1];
      // Two intervals overlap when neither sits entirely above the other.
      if (Math.min(a.adjustedGapHigh, b.adjustedGapHigh) >= Math.max(a.adjustedGapLow, b.adjustedGapLow)) {
        overlapping.push(`${a.group} and ${b.group}`);
      }
    }
    if (overlapping.length > 0) {
      lines.push(
        `  CANNOT BE RANKED: the 95% ranges for ${overlapping.join(", ")} overlap, so this file ` +
          `does not establish which is larger. If the question asks which is bigger, say that both ` +
          `matter and that the data cannot order them, and give both ranges. Do NOT rank them by ` +
          `the middle figure.`
      );
    } else {
      lines.push(
        `  RANKING IS SUPPORTED: the 95% ranges do not overlap, in this order - ` +
          `${byGap.map((r) => `${r.group} (${num(r.adjustedGapLow)} to ${num(r.adjustedGapHigh)})`).join(", ")}. ` +
          `This ranking may be reported.`
      );
    }
  }

  lines.push(
    `  WHAT THIS CANNOT SHOW: adjustment removes only the columns named above. ` +
      `This file is observational, so a difference that survives may still be caused by ` +
      `something not recorded in it, and none of these figures establish that one thing ` +
      `causes another. Nixara also cannot tell a cause from a consequence: if one of the ` +
      `columns held steady is itself downstream of the grouping, the adjusted figure is ` +
      `too small rather than too large. Treat the raw and adjusted figures as a range, ` +
      `not as a before and after, and say so rather than implying a cause.`
  );
  return lines.join("\n");
}
