/**
 * One answer to "what kind of column is this", computed once and read by
 * everything.
 *
 * Why this file exists. The engine had five or six independent notions of what
 * a column was, each re-derived at its own call site, and they disagreed. The
 * pattern was always the same: a rule gets fixed where someone noticed the
 * bug, and stays broken everywhere else.
 *
 *   - numericColumns() moved from .some() to a density threshold.
 *     isDateColumn() never did, so one stray Date cell in 50 rows deleted a
 *     file's only metric.
 *   - name normalization was added to isNonMetricName() so Student_ID would
 *     be recognised. detectMalformedEntries() kept testing the raw name, so
 *     id-integrity checking silently never ran on any snake_case export.
 *   - groupingColumns() was written so a date could not key a breakdown.
 *     selectChartColumns() kept calling categoricalColumns(), so the CHART
 *     the user sees first could still be a treemap keyed on a date column, or
 *     a pie whose largest slice was 95% blank.
 *   - looksLikeBoundedCount() filtered the prompt but not the on-screen
 *     anomaly banner, so the two surfaces contradicted each other.
 *
 * Five roles, decided once:
 *
 *   metric      a quantity that can be totalled or averaged
 *   label       a category that can key a breakdown
 *   date        a point in time: groupable by month, never an amount
 *   identifier  digits that name something rather than measure it
 *   unusable    too sparse, too mixed, or too near-unique to do either with
 *
 * The important design rule: VALUE SHAPE DECIDES FIRST, the name second. A
 * name-only filter is wrong in both directions. It excluded "Patient Count",
 * "Number of Units Sold" and "Consumer Price Index", which are the headline
 * metric of their file, and it could not recognise "Bestellnummer" or
 * "Numero de pedido" as identifiers at all, so a German export had its order
 * number chosen as the primary metric. Shape travels across languages; names
 * do not.
 */

import { isDateColumn } from "./format";

export type ColumnRole = "metric" | "label" | "date" | "identifier" | "unusable";

export interface ColumnRoleInfo {
  column: string;
  role: ColumnRole;
  /** Plain-English reason, shown to the user where a role needs explaining. */
  reason: string;
  /** Share of ALL rows holding a real number, 0 to 1. */
  numericShare: number;
  /** Share of ALL rows holding non-blank, non-numeric content. */
  textShare: number;
  blankShare: number;
  distinct: number;
  /** Whether grouping by this column would leave usable group sizes. */
  usableGroupSize: boolean;
}

/** Below this, a column is not numeric enough to be read as numbers at all. */
export const NUMERIC_THRESHOLD = 0.5;

/**
 * A column has to clear this before Nixara will total or average it.
 * Stricter than NUMERIC_THRESHOLD on purpose: averaging a column that is 60%
 * numbers describes 60% of the rows as though it described all of them.
 */
export const MIN_METRIC_COVERAGE = 0.8;

/** A label column may hold at most this share of numbers and still be a label. */
export const PARTLY_NUMERIC_MAX = 0.2;

/** A label column may be at most this blank. Past it, one "(blank)" group swallows the file. */
export const MAX_LABEL_BLANK_SHARE = 0.5;

/**
 * Names that SUGGEST an identifier. Never decisive on their own, and never
 * sufficient: a name match only counts when the VALUES agree (see
 * valuesLookLikeIdentifier). That is what lets "Patient Count", "Number of
 * Units Sold" and "Consumer Price Index" stay metrics.
 *
 * The compound forms are matched as substrings rather than whole words,
 * because German and the Romance languages build one word where English uses
 * two: "Bestellnummer" has no word boundary before "nummer", so /\bnummer\b/
 * never fires on it.
 */
const ID_NAME_PATTERNS = [
  /\bid\b/i,
  /\bids\b/i,
  /\bkey\b/i,
  /\bcount\b/i,
  /\bdistinct\b/i,
  /\bunique\b/i,
  /\bindex\b/i,
  /\brank\b/i,
  /\bnumber\b/i,
  /\bno\b\.?$/i,
  /\bcode\b/i,
  /\buuid\b/i,
  /\bguid\b/i,
  /nummer/i,
  /numero/i,
  /\bnro\b/i,
  /codigo/i,
];

/**
 * Names that mark a count as PRE-AGGREGATED: already summarised for the row
 * it sits on, so adding it across rows double-counts.
 *
 * Deliberately narrow. An earlier draft used the whole id lexicon here, which
 * classified "Patient Count" and "Platelet Count" as non-addable -- and those
 * are the headline metric of a hospital export. "distinct", "unique" and
 * "rank" genuinely cannot be summed; a plain "count" usually can.
 */
const PRE_AGGREGATED_PATTERNS = [/\bdistinct\b/i, /\bunique\b/i, /\brank\b/i];

/** Column name with separators flattened and camelCase split, so \b patterns fire. */
export function normalizeColumnName(col: string): string {
  return col
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();
}

/** Whether a column's NAME suggests an identifier. Only a hint: see roleOf(). */
export function nameSuggestsIdentifier(col: string): boolean {
  const normalized = normalizeColumnName(col);
  return ID_NAME_PATTERNS.some((pattern) => pattern.test(normalized));
}

const MONTH_NAME = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

/**
 * A date written as text, in the three shapes real exports produce:
 * all-numeric (2026-01-15, 11/8/2016), Oracle's 31-MAR-2025, and Mar 31 2025.
 */
const DATE_LIKE_TEXT = [
  /^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(\s|T|$)/,
  new RegExp(`^\\s*\\d{1,2}[-/.\\s](?:${MONTH_NAME})[a-z]*[-/.\\s]\\d{2,4}`, "i"),
  new RegExp(`^\\s*(?:${MONTH_NAME})[a-z]*\\s+\\d{1,2},?\\s+\\d{2,4}`, "i"),
];

function isBlankValue(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (typeof v === "string" && v.trim() === "");
}

/** Values that mean "position in space or on a calendar", not "amount". */
const POSITION_NAME_TOKENS = new Set([
  "latitude", "longitude", "lat", "lng", "lon", "zip", "zipcode", "postal",
  "postcode", "pincode", "fips", "geoid",
]);

interface ColumnStats {
  numeric: number;
  text: number;
  blank: number;
  dateTyped: number;
  dateText: number;
  total: number;
  distinct: number;
  allIntegers: boolean;
  nonDecreasing: boolean;
  distinctNumbers: number;
  min: number;
  max: number;
}

function collect(rows: Record<string, unknown>[], col: string): ColumnStats {
  const s: ColumnStats = {
    numeric: 0, text: 0, blank: 0, dateTyped: 0, dateText: 0,
    total: rows.length, distinct: 0, allIntegers: true, nonDecreasing: true,
    distinctNumbers: 0, min: Infinity, max: -Infinity,
  };
  const seen = new Set<unknown>();
  const seenNumbers = new Set<number>();
  let previous: number | null = null;
  // Date-shaped text is sampled: 200 values settle it on a 50,000-row file,
  // and this runs for every column.
  let sampled = 0;

  for (const row of rows) {
    const v = row[col];
    seen.add(v);
    if (isBlankValue(v)) {
      s.blank++;
      continue;
    }
    if (v instanceof Date) {
      s.dateTyped++;
      continue;
    }
    if (typeof v === "number") {
      s.numeric++;
      seenNumbers.add(v);
      if (!Number.isInteger(v)) s.allIntegers = false;
      if (previous !== null && v < previous) s.nonDecreasing = false;
      previous = v;
      if (v < s.min) s.min = v;
      if (v > s.max) s.max = v;
      continue;
    }
    s.text++;
    if (sampled < 200 && typeof v === "string") {
      sampled++;
      if (DATE_LIKE_TEXT.some((p) => p.test(v))) s.dateText++;
    }
  }
  s.distinct = seen.size;
  s.distinctNumbers = seenNumbers.size;
  return s;
}

/**
 * Whether a column is an identifier rather than a quantity.
 *
 * The honest position: a column of unique whole numbers that NAMES rows and a
 * column of unique whole numbers that MEASURES something cannot always be
 * told apart from the values alone. So shape and name have to agree, with one
 * exception where the shape is unmistakable.
 *
 *   Row index   a dense consecutive run from 0 or 1, one value per row. No
 *               quantity looks like this, so no name is needed.
 *   Named id    near-unique whole numbers in a column whose name says id,
 *               key, number, code, nummer, numero. Both must hold.
 *
 * What this change fixed, in both directions. Earlier drafts used "name
 * matches" alone, which excluded "Patient Count" and "Consumer Price Index",
 * and could not see "Bestellnummer" at all because the patterns were English.
 * Then they used "near-unique integers" alone, which swallowed any sorted or
 * whole-dollar amount column: a synthetic Sales column of 100..117 came back
 * as an identifier. Requiring both is what holds in both directions.
 *
 * Deliberately NOT a signal: integers that merely never decrease. Exports are
 * often sorted by their amount column, and a cumulative column never
 * decreases by definition.
 */
function valuesLookLikeIdentifier(col: string, s: ColumnStats): boolean {
  if (s.numeric < 5 || !s.allIntegers || s.min < 0) return false;
  const uniqueRatio = s.distinctNumbers / s.numeric;
  const rangeDensity = s.distinctNumbers / (s.max - s.min + 1);

  // A row index: effectively one consecutive value per row, starting at 0 or 1.
  if (s.numeric >= 10 && uniqueRatio >= 0.99 && rangeDensity >= 0.99 && s.min <= 1) return true;

  return nameSuggestsIdentifier(col) && uniqueRatio >= 0.9;
}

/** Calendar years and coordinates: complete, numeric, and still not amounts. */
function valuesLookLikePosition(col: string, s: ColumnStats): boolean {
  const tokens = normalizeColumnName(col).toLowerCase().split(/\s+/);
  if (tokens.some((t) => POSITION_NAME_TOKENS.has(t))) return true;
  // A calendar year: integers inside a plausible year range, several of them.
  if (
    s.numeric >= 5 &&
    s.allIntegers &&
    s.min >= 1800 &&
    s.max <= 2100 &&
    s.distinctNumbers >= 2
  ) {
    return true;
  }
  // Coordinates by shape: fractional values inside the lat/long envelope with
  // real precision, which no business amount has.
  if (s.numeric >= 10 && !s.allIntegers && s.min >= -180 && s.max <= 180) {
    const span = s.max - s.min;
    if (span > 0 && span < 180 && s.distinctNumbers / s.numeric > 0.5 && Math.abs(s.max) <= 180) {
      // Not decisive on its own -- a percentage or a rating also lives here --
      // so the name has to agree.
      if (tokens.some((t) => POSITION_NAME_TOKENS.has(t))) return true;
    }
  }
  return false;
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

/**
 * Whether grouping by a column leaves enough rows per group to mean anything.
 * Twenty or fewer labels is always allowed: a pre-aggregated export with one
 * row per Region x Category has barely more rows than groups and is still the
 * right thing to group by.
 */
function usableGroupSize(distinct: number, total: number): boolean {
  if (total === 0 || distinct < 2 || distinct > total) return false;
  if (distinct <= 20) return true;
  return distinct * 1.5 <= total;
}

/**
 * Whether a numeric column stands in one-to-one correspondence with some text
 * column: each number goes with exactly one label and each label with exactly
 * one number.
 *
 * This is the signal that separates the two cases name-and-shape cannot:
 *
 *   TASK_NUMBER    1, 2, 3 repeated, and TASK_NUMBER 2 is always
 *                  "Build & Configure". It identifies the task.
 *   Patient Count  3, 7, 2 repeated, and a count of 7 turns up in several
 *                  wards while a ward reports several counts. It measures.
 *
 * An id for a thing is functionally determined by that thing's name, and a
 * measurement is not. The test is language-independent, which is the point.
 *
 * Only run when the column's NAME already hinted at an identifier, both to
 * keep it off the hot path and because on its own it would misread a genuine
 * metric that happens to be unique per category.
 */
function hasOneToOneLabel(
  dataset: { rows: Record<string, unknown>[]; columns: string[] },
  col: string,
  s: ColumnStats
): boolean {
  if (s.distinctNumbers < 2 || s.distinctNumbers > 100) return false;

  for (const other of dataset.columns) {
    if (other === col) continue;
    const numberToLabel = new Map<number, unknown>();
    const labelToNumber = new Map<unknown, number>();
    let pairs = 0;
    let oneToOne = true;

    for (const row of dataset.rows) {
      const n = row[col];
      const l = row[other];
      if (typeof n !== "number") continue;
      if (typeof l !== "string" || l.trim() === "") {
        oneToOne = false;
        break;
      }
      pairs++;
      const seenLabel = numberToLabel.get(n);
      if (seenLabel === undefined) numberToLabel.set(n, l);
      else if (seenLabel !== l) {
        oneToOne = false;
        break;
      }
      const seenNumber = labelToNumber.get(l);
      if (seenNumber === undefined) labelToNumber.set(l, n);
      else if (seenNumber !== n) {
        oneToOne = false;
        break;
      }
    }

    if (oneToOne && pairs >= 5 && numberToLabel.size >= 2 && numberToLabel.size === labelToNumber.size) {
      return true;
    }
  }
  return false;
}

function roleOf(dataset: { rows: Record<string, unknown>[]; columns: string[] }, col: string): ColumnRoleInfo {
  const s = collect(dataset.rows, col);
  const total = s.total || 1;
  const numericShare = s.numeric / total;
  const textShare = s.text / total;
  const blankShare = s.blank / total;
  const nonBlank = s.numeric + s.text + s.dateTyped;
  const base = {
    column: col,
    numericShare,
    textShare,
    blankShare,
    distinct: s.distinct,
    usableGroupSize: usableGroupSize(s.distinct, total),
  };

  // ── Dates ────────────────────────────────────────────────────────────────
  // A density test, not .some(). The old isDateColumn returned true if ANY
  // cell was a Date, so one mis-formatted cell in an Excel export deleted the
  // file's only metric and told the user it was "dates, not amounts".
  if (nonBlank > 0 && s.dateTyped / nonBlank > NUMERIC_THRESHOLD) {
    return { ...base, role: "date", reason: "dates, which are points in time rather than amounts" };
  }
  if (s.text > 0 && s.dateText / Math.min(s.text, 200) >= 0.7) {
    return { ...base, role: "date", reason: "dates written as text" };
  }

  // ── Not numeric enough to be a quantity ──────────────────────────────────
  if (numericShare <= PARTLY_NUMERIC_MAX) {
    if (blankShare > MAX_LABEL_BLANK_SHARE) {
      return { ...base, role: "unusable", reason: `${pct(s.blank, total)}% blank, too empty to group by` };
    }
    if (!base.usableGroupSize) {
      return {
        ...base,
        role: "unusable",
        reason:
          s.distinct < 2
            ? "only one distinct value"
            : `${s.distinct.toLocaleString()} distinct values across ${total.toLocaleString()} rows, so grouping by it would just re-list the rows`,
      };
    }
    return { ...base, role: "label", reason: "a category" };
  }

  // ── Partly numeric: neither a quantity nor a label ───────────────────────
  if (numericShare < MIN_METRIC_COVERAGE) {
    if (textShare >= 0.1) {
      return {
        ...base,
        role: "unusable",
        reason: `${pct(s.text, total)}% text, ${pct(s.numeric, total)}% numbers, ${pct(s.blank, total)}% blank`,
      };
    }
    return { ...base, role: "unusable", reason: `only ${pct(s.numeric, total)}% of rows carry a number` };
  }

  // ── Numeric enough. Quantity, position, or identifier? ───────────────────
  if (valuesLookLikePosition(col, s)) {
    return {
      ...base,
      role: "identifier",
      reason: "coordinates or calendar years, which are positions rather than amounts",
    };
  }
  // Shape first. A name hint alone never disqualifies a metric, which is what
  // used to exclude "Patient Count" and "Consumer Price Index"; and shape
  // alone is enough to catch "Bestellnummer", which no English pattern knows.
  if (valuesLookLikeIdentifier(col, s)) {
    return {
      ...base,
      role: "identifier",
      reason: nameSuggestsIdentifier(col)
        ? "an identifier: its name and its values both say so"
        : "an identifier: one value per row, in order, naming rows rather than measuring them",
    };
  }
  // A pre-aggregated count: a per-slice "distinct" or "unique" tally, or a
  // rank. Valid for the row it sits on, meaningless added across rows. Only
  // the narrow lexicon qualifies, so a plain "Patient Count" stays a metric.
  if (PRE_AGGREGATED_PATTERNS.some((p) => p.test(normalizeColumnName(col))) && s.min >= 0) {
    return {
      ...base,
      role: "identifier",
      reason: "a pre-aggregated count or rank, valid per row but not addable across rows",
    };
  }

  // Last resort for the ambiguous case: the name hints at an identifier and
  // the values are too repetitive for the uniqueness test, but the column
  // names an entity that a text column also names. TASK_NUMBER in the Oracle
  // ERP sample is this: 1, 2, 3 repeated, each tied to one TASK_NAME.
  if (nameSuggestsIdentifier(col) && s.allIntegers && hasOneToOneLabel(dataset, col, s)) {
    return {
      ...base,
      role: "identifier",
      reason: "an identifier: each value belongs to exactly one named thing in another column",
    };
  }

  return { ...base, role: "metric", reason: "a quantity" };
}

/**
 * Roles for every column, memoized per dataset object.
 *
 * Memoized because this walks every cell and is now read by the chart picker,
 * the summary builder, the quality score, the evidence trail and three
 * panels. A WeakMap keyed on the dataset is enough: datasets are replaced
 * rather than mutated (cleanDataset returns a new object), so a stale entry
 * is not reachable.
 */
const CACHE = new WeakMap<object, Map<string, ColumnRoleInfo>>();

export function resolveColumnRoles(dataset: {
  rows: Record<string, unknown>[];
  columns: string[];
}): Map<string, ColumnRoleInfo> {
  const hit = CACHE.get(dataset);
  if (hit) return hit;
  const map = new Map<string, ColumnRoleInfo>();
  for (const col of dataset.columns) map.set(col, roleOf(dataset, col));
  CACHE.set(dataset, map);
  return map;
}

export function columnsWithRole(
  dataset: { rows: Record<string, unknown>[]; columns: string[] },
  role: ColumnRole
): string[] {
  const roles = resolveColumnRoles(dataset);
  return dataset.columns.filter((col) => roles.get(col)?.role === role);
}

export function roleInfo(
  dataset: { rows: Record<string, unknown>[]; columns: string[] },
  col: string
): ColumnRoleInfo | undefined {
  return resolveColumnRoles(dataset).get(col);
}

/** Re-exported so callers do not reach past the resolver for the date test. */
export { isDateColumn };
