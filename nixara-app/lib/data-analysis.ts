/**
 * Client-side port of the data-analysis helpers from dashboard_ai_app.py
 * (clean_dataframe, detect_anomalies, dashboard_score, smart_agg, build_data_summary).
 * Operates on a simple row-array representation instead of pandas DataFrames.
 */

import { formatDateSafe, isDateColumn, monthBucketKey, monthBucketSortKey } from "./format";
// Numeric reading lives in number-format.ts and is decided once per column.
// There is deliberately no single-cell "toNumber" helper in this file any
// more: every former caller of it assumed the dot-decimal style, which is the
// assumption that read a German revenue column at a thousandth of its value.
// Code that needs to read a cell must say which style it is reading in.
import {
  detectColumnNumberFormat,
  parseDecoratedNumber,
  type ColumnNumberFormat,
} from "./number-format";
// Every "what kind of column is this" question goes through the resolver.
// Nothing in this file may re-derive a role locally: that is exactly how the
// chart picker ended up disagreeing with the summary builder about whether a
// date column was a category.
import { stripAggregateRows } from "./aggregate-rows";
import { detectColumnDateFormat, parseDateLike } from "./date-format";
import {
  columnsWithRole,
  isMissingValue,
  resolveColumnRoles,
  roleInfo,
  nameSuggestsIdentifier,
  NUMERIC_THRESHOLD,
  MIN_METRIC_COVERAGE,
} from "./column-roles";

export type Row = Record<string, unknown>;

export interface Dataset {
  rows: Row[];
  columns: string[];
  /**
   * Non-fatal notes from reading the file (e.g. rows whose column count did
   * not match the header). Shown to the user above the dashboard. Optional:
   * most datasets have none, and every analysis function ignores it.
   */
  warnings?: string[];
  /**
   * The CSV delimiter the file actually used, when the source was a CSV.
   * Read only as a tie-breaker for ambiguous number formats -- a
   * semicolon-delimited file is a European export, because the comma being
   * the decimal mark is the only reason Excel writes semicolons. See
   * detectColumnNumberFormat() in number-format.ts.
   */
  sourceDelimiter?: string;
  /**
   * How each numeric column's cells were read, filled in by cleanDataset().
   * Present so the quality panel can tell the user that a column was read as
   * European format or that its negatives were in parentheses, rather than
   * the product making that call silently. Every analysis function ignores it.
   */
  numberFormats?: Record<string, ColumnNumberFormat>;
}


/** Leaves headroom under the server's 8,000-char summary cap (route.ts MAX_SUMMARY_CHARS). */
const DERIVED_SUMMARY_BUDGET = 7500;

/**
 * Mirrors clean_dataframe: turns string columns into numbers where the column
 * reads as numeric.
 *
 * REWRITTEN (2026-10). The old version applied `replace(/[$,]/g, "")` to each
 * cell independently, which deletes commas wherever they appear and
 * understands nothing else. A German revenue column of "1.234,56" became
 * 1.23456 -- wrong by a factor of a thousand, 100% numeric, quality score
 * 100, and no warning anywhere. Excel's own accounting format ("-$1,500.87",
 * "(1,234.00)") failed to parse at all, so every loss row became null and the
 * column was then either reported as mostly missing or, worse, reclassified
 * as a CATEGORY and charted as one.
 *
 * The format is now decided once per column from the column's own evidence
 * (see number-format.ts), then applied uniformly. Three further rules matter:
 *
 *  - A column is converted only if it reads above NUMERIC_THRESHOLD. Below
 *    that it stays text, so a mixed column keeps its text half instead of
 *    having it overwritten with nulls.
 *  - Leading-zero identifiers (postal codes, store codes, account numbers)
 *    are never converted, whatever their coverage.
 *  - The decision is recorded on the returned dataset, so the UI can say what
 *    was done rather than the product doing it silently.
 */
export function cleanDataset(dataset: Dataset): Dataset {
  const { rows, columns } = dataset;
  if (rows.length === 0) return { ...dataset, columns };

  const roles = resolveColumnRoles(dataset);
  const formats: Record<string, ColumnNumberFormat> = {};
  for (const col of columns) {
    const detected = detectColumnNumberFormat(
      rows.map((row) => row[col]),
      { delimiter: dataset.sourceDelimiter }
    );
    if (detected && detected.coverage > NUMERIC_THRESHOLD) formats[col] = detected;
  }

  // Date columns are turned into real Date objects, decided per column the
  // same way the number format is (see date-format.ts). Until Oct 2026 only
  // the Excel reader ever produced a Date, so findDateColumn and
  // bucketByMonth found nothing in a CSV and no CSV upload has ever drawn a
  // trend over time -- on every one of the demo files, despite every one of
  // them having a date column.
  const dateFormats: Record<string, ReturnType<typeof detectColumnDateFormat>> = {};
  for (const col of columns) {
    if (formats[col]) continue; // already a numeric column
    const info = roles.get(col);
    if (info?.role !== "date") continue;
    const detected = detectColumnDateFormat(
      rows.map((row) => row[col]),
      { delimiter: dataset.sourceDelimiter }
    );
    if (detected && detected.coverage > NUMERIC_THRESHOLD) dateFormats[col] = detected;
  }

  const converting = Object.keys(formats);
  const convertingDates = Object.keys(dateFormats);
  const cleanedRows = rows.map((row) => {
    const next: Row = { ...row };
    for (const col of converting) {
      const fmt = formats[col];
      const parsed = parseDecoratedNumber(row[col], fmt.style, fmt.traits.unit);
      // A cell that does not parse keeps its ORIGINAL value rather than
      // becoming null. The old version overwrote the whole column, so a Size
      // column of 12,14,16,XL,L,M lost XL/L/M entirely and was then reported
      // as 40% blank on a file with no blank cells at all. Keeping the text
      // is both truthful and what lets the quality score see the column for
      // what it is: part text, part number.
      if (parsed !== null) next[col] = parsed;
      else if (isMissingValue(row[col])) next[col] = null;
    }
    for (const col of convertingDates) {
      const parsed = parseDateLike(row[col], dateFormats[col]!.order);
      if (parsed !== null) next[col] = parsed;
      else if (isMissingValue(row[col])) next[col] = null;
    }
    return next;
  });

  // Spread first so optional fields such as `warnings` survive cleaning.
  return {
    ...dataset,
    rows: cleanedRows,
    columns,
    numberFormats: converting.length > 0 ? formats : undefined,
  };
}

/**
 * The one entry pipeline for a freshly read file.
 *
 * Every upload route -- file, Tableau, Power BI -- called cleanDataset
 * directly, which meant adding a step to the intake meant finding and editing
 * three call sites and hoping none was missed. That is the same
 * fix-at-one-call-site pattern the role resolver exists to end, so intake is
 * now one function:
 *
 *   1. cleanDataset   decide each column's number format and type its cells
 *   2. strip summary  take out "Grand Total" and subtotal rows, which would
 *                     otherwise double every total and become the largest
 *                     category in every breakdown
 *
 * Anything removed is named in dataset.warnings, which the upload screen
 * shows above the dashboard.
 */
export function prepareDataset(raw: Dataset): Dataset {
  return stripAggregateRows(cleanDataset(raw)).dataset;
}

/**
 * Share of a column's rows that hold an actual number, 0 to 1.
 */
export function numericDensity(dataset: Dataset, col: string): number {
  if (dataset.rows.length === 0) return 0;
  let n = 0;
  for (const row of dataset.rows) if (typeof row[col] === "number") n++;
  return n / dataset.rows.length;
}

/**
 * Thin delegations to the column-role resolver.
 *
 * These names are kept because the whole codebase and its tests use them, but
 * none of them decides anything any more: every one is one line over
 * resolveColumnRoles(). That is the point. Before Oct 2026 each of these
 * re-derived its own answer, and the answers disagreed -- the chart picker
 * could key a treemap on a date column that the summary builder had already
 * refused to group by, because the two asked different functions.
 *
 * See column-roles.ts for the roles, the thresholds and the reasoning.
 */
export { MIN_METRIC_COVERAGE, NUMERIC_THRESHOLD };
export { resolveColumnRoles, columnsWithRole, roleInfo } from "./column-roles";
export type { ColumnRole, ColumnRoleInfo } from "./column-roles";

/** Columns numeric enough to be read as numbers. */
export function numericColumns(dataset: Dataset): string[] {
  const roles = resolveColumnRoles(dataset);
  return dataset.columns.filter((col) => {
    const info = roles.get(col);
    return info !== undefined && info.numericShare > NUMERIC_THRESHOLD;
  });
}

/** Columns Nixara will total or average. */
export function businessMetricColumns(dataset: Dataset): string[] {
  return columnsWithRole(dataset, "metric");
}

/** Every column that is not numeric enough to be a quantity. */
export function categoricalColumns(dataset: Dataset): string[] {
  const roles = resolveColumnRoles(dataset);
  return dataset.columns.filter((col) => {
    const info = roles.get(col);
    return info !== undefined && info.numericShare <= NUMERIC_THRESHOLD;
  });
}

/**
 * Columns that may be the GROUP KEY of a breakdown or the category axis of a
 * chart. Both surfaces now read this one list, which is the fix for a chart
 * keyed on a date column or on a column that is 95% blank.
 */
export function groupingColumns(dataset: Dataset): string[] {
  return columnsWithRole(dataset, "label");
}

/** Whether grouping by a column leaves usable group sizes. */
export function hasUsableGroupSize(dataset: Dataset, col: string): boolean {
  return roleInfo(dataset, col)?.usableGroupSize ?? false;
}

/** Whether a column's NAME suggests an identifier. A hint only -- shape decides. */
export function isNonMetricName(col: string): boolean {
  return nameSuggestsIdentifier(col);
}

/**
 * Whether a numeric column's values look like a small bounded count or scale
 * (e.g. "children", "chronic_diseases", a 1-5 rating) rather than a genuine
 * continuous business metric -- detected by the SHAPE of its values (all
 * non-negative integers, few distinct values), the same way smartAgg already
 * classifies additive vs. per-entity columns by value shape instead of by name.
 *
 * This matters for anomaly detection specifically: z-score flags anything
 * more than 2 std devs from the mean, but on a column that only ever takes
 * values like 0-5, the top of that range is ALWAYS more than 2 std devs out
 * once the distribution skews low (most people have 0-1 children/conditions).
 * That isn't a real outlier, it's just the natural ceiling of a small bounded
 * count -- flagging it as an "anomalous row" is statistically misleading, even
 * though the column's NAME doesn't match any of NON_METRIC_PATTERNS above.
 */
export function looksLikeBoundedCount(dataset: Dataset, col: string): boolean {
  const values = dataset.rows
    .map((r) => r[col])
    .filter((v): v is number => typeof v === "number");
  if (values.length === 0) return false;
  if (!values.every((v) => Number.isInteger(v) && v >= 0)) return false;
  return new Set(values).size <= 10;
}

// ── Generic (industry-agnostic) column relevance matching ──────────────────
//
// Deliberately contains NO domain vocabulary (no "profit"/"revenue"/etc). It only
// knows generic English grammar (stopwords, plural stripping, camelCase splitting)
// so it works the same whether the uploaded data is retail, healthcare, construction,
// legal, or anything else — relevance comes entirely from the user's own words.

const GENERIC_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "for", "to", "is", "are",
  "was", "were", "be", "been", "being", "we", "you", "your", "our", "it",
  "its", "this", "that", "these", "those", "with", "by", "at", "as", "should",
  "which", "what", "where", "when", "who", "whom", "how", "do", "does", "did",
  "if", "than", "then", "so", "not", "no", "yes", "into", "about", "over",
  "under", "up", "down", "out", "vs", "versus", "us", "i", "have", "has",
  "had", "will", "would", "can", "could", "may", "might", "must", "need",
  "any", "all", "each", "per",
]);

/** Naive English singularization — strips common plural suffixes. Generic, not domain-specific. */
function singularize(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  // Only strip "-es" for the sibilant-plural pattern (boxes->box, matches->match,
  // wishes->wish) — NOT for words that just add "s" to a base ending in "e"
  // (rates->rate, sales->sale), which the "s"-strip rule below already handles.
  if (word.length > 4 && /(?:[sxz]|[cs]h)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Splits a string (free text OR a column name, including camelCase/snake_case) into normalized tokens. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase -> camel Case
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => singularize(t.toLowerCase()))
    .filter((t) => t.length > 2 && !GENERIC_STOPWORDS.has(t));
}

/** Number of overlapping tokens between a free-text question and a column name. */
function relevanceScore(questionTokens: Set<string>, columnName: string): number {
  if (questionTokens.size === 0) return 0;
  const colTokens = tokenize(columnName);
  let score = 0;
  for (const t of colTokens) {
    if (questionTokens.has(t)) score++;
  }
  return score;
}

/**
 * Generic keyword-to-column matcher: scores every candidate column against a
 * fixed keyword list using the same token-overlap approach as the free-text
 * relevance scoring above, instead of a user-typed decision question. No
 * per-dataset or per-domain special-casing -- whatever overlaps, overlaps.
 * Used by lib/decision-templates.ts so a Common Decision chip can name the
 * columns THIS dataset actually has, rather than only ever inserting the same
 * generic boilerplate text regardless of what was uploaded.
 */
export function matchKeywordsToColumns(columns: string[], keywords: string[], limit = 2): string[] {
  const keywordTokens = new Set(keywords.flatMap((k) => tokenize(k)));
  if (keywordTokens.size === 0) return [];
  return columns
    .map((col) => ({ col, score: relevanceScore(keywordTokens, col) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.col);
}

/**
 * Fraction of `originalColumns` still present in `newColumns` (exact match,
 * case/whitespace-insensitive). This is a cheap dataset-identity sanity
 * check, not a lineage guarantee: Nixara currently identifies "the same
 * dataset" across an upload/session boundary purely by filename, so two
 * uploads that happen to share a name but hold genuinely different data
 * (e.g. two different exports both called "monthly_data.csv") could
 * otherwise be silently treated as one continuous dataset for outcome
 * auto-fill / Decision Drift baselines. Before trusting a filename match,
 * callers (see app/inbox/page.tsx) also require the new dataset's schema to
 * overlap the original's by at least SCHEMA_OVERLAP_THRESHOLD.
 *
 * Deliberately simple: it will not catch a dataset that was reshaped but
 * kept identical column names, and it may reject a legitimately-evolved
 * export that renamed or dropped several columns. A real fix is a persisted
 * dataset identity (content hash or an explicit versioned-dataset system);
 * this narrows the failure window without requiring that larger change.
 */
export function schemaOverlapRatio(originalColumns: string[], newColumns: string[]): number {
  if (originalColumns.length === 0) return 0;
  const normalize = (c: string) => c.trim().toLowerCase();
  const newSet = new Set(newColumns.map(normalize));
  const matched = originalColumns.filter((c) => newSet.has(normalize(c))).length;
  return matched / originalColumns.length;
}

/** Minimum schemaOverlapRatio() to treat two same-named uploads as "the same dataset" for auto-fill purposes. */
export const SCHEMA_OVERLAP_THRESHOLD = 0.8;

export interface ChartColumnSelection {
  category: string | null;
  metrics: string[]; // up to 2, ordered by relevance/priority
  /**
   * The column the question actually named, when one was identified. Lets
   * the chart say "you asked about Location, this is Status" instead of
   * substituting in silence.
   */
  asked: string | null;
}

/**
 * How well a column answers what the user typed.
 *
 * Three kinds of evidence, strongest first. The old version had only the
 * third, which is why "Location" and "location" scored the same as a column
 * that merely shared one generic word, and why typing a VALUE rather than a
 * column name matched nothing at all.
 *
 *   100  the question names the column, give or take case and separators
 *    60  the question contains a VALUE from this column ("Coney Island",
 *        "Operating"). This is the dataset-driven half: it needs no lexicon
 *        and works in any language, because the evidence is the user's own
 *        data rather than a word list.
 *   1/token  shared words, which is what the old score did on its own
 */
function columnMatchScore(
  dataset: Dataset,
  column: string,
  question: string,
  questionTokens: Set<string>
): number {
  const flat = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const q = flat(question);
  if (q === "") return 0;

  const name = flat(column);
  if (name !== "" && (q === name || q.includes(name))) return 100;

  // Does the question quote one of this column's own values?
  const seen = new Set<string>();
  for (const row of dataset.rows) {
    const v = row[column];
    if (typeof v !== "string") continue;
    const f = flat(v);
    if (f.length < 3 || seen.has(f)) continue;
    seen.add(f);
    if (q.includes(f)) return 60;
    if (seen.size >= 400) break;
  }

  return relevanceScore(questionTokens, column);
}

/**
 * Where in the question a column's name appears, or -1.
 *
 * People write "metric by category", so when two columns match equally well
 * the one mentioned LATER is the one being grouped by. Without this,
 * "speed by manufacturer" on coaster_db charted by Speed, because both names
 * matched exactly and file order decided.
 */
function questionPosition(column: string, question: string): number {
  const flat = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const q = flat(question);
  const name = flat(column);
  if (q === "" || name === "") return -1;
  return q.lastIndexOf(name);
}

/**
 * How well a column works AS A CHART AXIS, ignoring the question.
 *
 * Only used to break ties and to choose a default when nothing was typed.
 * Removing the old cardinality veto fixed "Location", but it also meant the
 * default chart became whatever label column happened to come first in the
 * file: coaster_db opened on Length (521 values) and the superstore file on
 * Order ID (5,016). A few distinct values read well; thousands do not, even
 * with the tail collapsed.
 */
function chartability(dataset: Dataset, column: string): number {
  const info = roleInfo(dataset, column);
  const distinct = info?.distinct ?? 0;
  const base =
    distinct >= 2 && distinct <= 15 ? 100 : distinct <= 40 ? 70 : distinct <= 200 ? 40 : 15;
  return base - Math.round((info?.blankShare ?? 0) * 30);
}

/**
 * Picks which categorical column and up to 2 numeric metric columns to chart.
 *
 * When decisionText overlaps with column names, those columns are preferred —
 * so "Which regions are driving readmission rates?" surfaces Region / Readmission
 * Rate for a hospital dataset just as well as "which regions drive profit" surfaces
 * Region / Profit for a retail one. No industry vocabulary is hardcoded.
 *
 * Falls back to structural defaults (file column order, excluding ID/count/key/rank
 * columns via businessMetricColumns) when there's no question text yet or no overlap.
 */
export function selectChartColumns(dataset: Dataset, decisionText: string): ChartColumnSelection {
  // BUG FIX (2026-10): this used categoricalColumns(), which is simply
  // "everything the numeric filter rejected" and therefore includes date
  // columns, half-numeric amount columns and columns that are almost entirely
  // blank. The summary builder had already been fixed to use groupingColumns;
  // the CHART, which is the first thing the user sees, had not. Verified
  // outputs before this change: a treemap titled "Total Sales by When" keyed
  // on a text date column, and a pie titled "Total Sales by Website" whose
  // largest slice was an unlabelled 95% of the data. Both surfaces now read
  // the same one list of label columns.
  const cats = groupingColumns(dataset);
  const metricCols = businessMetricColumns(dataset);
  // A trend over time needs a metric and a date, not a category, so metrics
  // are still returned when no label column exists. market_trend.csv has two
  // metrics and a date column and was getting no chart at all, because this
  // bailed out on the missing category before the caller could ask about the
  // time axis.
  if (metricCols.length === 0) return { category: null, metrics: [], asked: null };

  const question = decisionText ?? "";
  const questionTokens = new Set(tokenize(question));
  const score = (c: string) => columnMatchScore(dataset, c, question, questionTokens);

  const metricCandidates = [...metricCols].sort(
    (a, b) => score(b) - score(a) || questionPosition(b, question) - questionPosition(a, question)
  );
  const metrics = metricCandidates.slice(0, 2);

  // No label column is not the end of the road: a trend over time needs a
  // metric and a date, not a category.
  if (cats.length === 0) return { category: null, metrics, asked: null };

  // The highest-scoring label column wins. There is no longer a cardinality
  // veto here: a column with 280 values is charted with its tail collapsed
  // into "Other" (see collapseTail) rather than skipped, which is what used
  // to make "Location" silently become "Status". Three keys, in order: how
  // well the column answers the question, where it was mentioned ("X by Y"
  // means group by Y), and how well it reads as an axis. The third decides
  // on its own when nothing was typed.
  const catScores = new Map(cats.map((c) => [c, score(c)] as const));
  const catCandidates = [...cats].sort((a, b) =>
    (catScores.get(b) ?? 0) - (catScores.get(a) ?? 0) ||
    questionPosition(b, question) - questionPosition(a, question) ||
    chartability(dataset, b) - chartability(dataset, a)
  );
  const category = catCandidates[0] ?? null;
  const asked = (catScores.get(catCandidates[0] ?? "") ?? 0) > 0 ? catCandidates[0] : null;

  return { category, metrics, asked };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[], m: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export interface NumericStats {
  count: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  total: number;
}

/**
 * BUG FIX (2026-09): buildDataSummary computed min and max with
 * Math.min(...values) / Math.max(...values). Spreading an array into a call
 * passes one argument per element, and every JS engine caps that at a fixed
 * number of stack slots - V8 throws
 *
 *     RangeError: Maximum call stack size exceeded
 *
 * somewhere around 125k arguments. Reproduced at 300k. The upload limit is
 * 20 MB, which for a typical business CSV is several hundred thousand rows,
 * so any large file crashed report generation outright - and it crashed
 * inside the summary builder, so the user saw a generic failure with no clue
 * that file size was the cause.
 *
 * Computed in a single explicit pass instead. No stack involvement, and it
 * folds the mean/total/min/max walks the caller was doing separately into one.
 */
export function numericStats(values: number[]): NumericStats {
  if (values.length === 0) {
    return { count: 0, mean: 0, std: 0, min: 0, max: 0, total: 0 };
  }

  let min = Infinity;
  let max = -Infinity;
  let total = 0;

  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    total += v;
  }

  const m = total / values.length;
  return { count: values.length, mean: m, std: std(values, m), min, max, total };
}

/** Mirrors detect_anomalies: rows where |z-score| > 2 for the given numeric column. */
/**
 * Columns where "far from the column's average" carries no meaning, so
 * flagging them is noise rather than signal: geographic coordinates, postal
 * codes, and calendar years. A ride at latitude -48.26 or a ride opened in
 * 1884 is valid; it is simply not a business risk, and listing it next to
 * real metrics buries the ones that matter.
 *
 * Coordinates and postal codes are matched by NAME. Years are matched by
 * SHAPE (every value a whole number between 1800 and 2100) rather than by a
 * "year" name token, because "Years of Experience" is a genuine measure that
 * must keep being checked. This runs inside detectAnomalies(), so the upload
 * notice, the Risk Report's anomaly lines and the quality score all agree.
 */
const OUTLIER_SKIP_TOKENS = new Set([
  "latitude", "longitude", "lat", "lon", "lng", "zip", "postal", "postcode", "pincode",
]);

/**
 * True when a column holds coordinates rather than quantities: dates, years,
 * latitudes, longitudes, postal codes.
 *
 * These are positions on a scale, not amounts. You cannot meaningfully add or
 * average a postcode, and the average of a set of opening dates answers no
 * business question. The codebase already knew this for anomaly detection and
 * nowhere else, so metric selection happily charted them. One rule now serves
 * both, which is why isOutlierMeaninglessColumn is kept as the name the
 * anomaly path already uses.
 */
export function isNonQuantityColumn(dataset: Dataset, col: string): boolean {
  // Delegated to the resolver, which applies a DENSITY test for dates rather
  // than the old isDateColumn `.some()`. One mis-formatted cell in a 50-row
  // Excel export used to make a whole Amount column "a date", deleting the
  // file's only metric and telling the user it held points in time.
  const role = roleInfo(dataset, col)?.role;
  if (role === "date") return true;
  return isOutlierMeaninglessColumn(dataset, col);
}

export function isOutlierMeaninglessColumn(dataset: Dataset, col: string): boolean {
  if (tokenize(col).some((t) => OUTLIER_SKIP_TOKENS.has(t))) return true;
  let seen = 0;
  for (const row of dataset.rows) {
    const v = row[col];
    if (typeof v !== "number") continue;
    if (!Number.isInteger(v) || v < 1800 || v > 2100) return false;
    seen++;
  }
  return seen >= 5;
}

export function detectAnomalies(dataset: Dataset, col: string): Row[] {
  if (isOutlierMeaninglessColumn(dataset, col)) return [];
  const present = dataset.rows
    .map((r, i) => ({ row: r, value: r[col], i }))
    .filter((x) => typeof x.value === "number") as { row: Row; value: number; i: number }[];

  if (present.length < 5) return [];
  const values = present.map((x) => x.value);
  const m = mean(values);
  const s = std(values, m);
  if (s === 0) return [];

  return present
    .filter((x) => Math.abs((x.value - m) / s) > 2)
    .map((x) => x.row);
}

export interface AnomalyDescription {
  column: string;
  count: number;
  /** The single most extreme flagged value (largest |z-score|), in the column's own raw scale. */
  extremeValue: number;
  /** Whether that extreme sits above or below the column's mean. */
  direction: "high" | "low";
  /** Whether extremeValue is a 0-1 ratio (render as a percentage) rather than a plain number. */
  isProportion: boolean;
}

/**
 * Companion to detectAnomalies(): describes WHAT the flagged rows actually
 * look like, not just how many there are.
 *
 * BUG FIX (2026-09): the anomaly banner told the user "N columns show
 * statistically unusual values" and (after an earlier fix) named the
 * columns, but never said what value was actually unusual in any of them --
 * the only way to see a real number was to generate a full Risk Report and
 * hope the model's prose happened to mention it, which it often didn't
 * (Early Warning Signs/Top Risks only cover what the model judged
 * risk-worthy, not every flagged column). This surfaces the single most
 * extreme flagged value per column directly from the dataset,
 * deterministically -- no model involved, so it can't be wrong or omitted.
 *
 * Deliberately never guesses a currency symbol: there is no reliable way to
 * know an arbitrary numeric column is denominated in dollars from its name
 * or shape alone (that is exactly the class of mistake fixed elsewhere in
 * this file -- see the profitCols/primaryMetric notes above). A column
 * shaped like a 0-1 ratio (see looksLikeProportion) is unambiguous and
 * rendered as a percentage; everything else is a plain formatted number.
 */
export function describeAnomalies(dataset: Dataset, col: string): AnomalyDescription | null {
  const rows = detectAnomalies(dataset, col);
  if (rows.length === 0) return null;

  const allValues = dataset.rows
    .map((r) => r[col])
    .filter((v): v is number => typeof v === "number");
  const stats = numericStats(allValues);

  let extremeValue = rows[0][col] as number;
  for (const row of rows) {
    const v = row[col] as number;
    if (Math.abs(v - stats.mean) > Math.abs(extremeValue - stats.mean)) extremeValue = v;
  }

  return {
    column: col,
    count: rows.length,
    extremeValue,
    direction: extremeValue >= stats.mean ? "high" : "low",
    isProportion: looksLikeProportion(allValues),
  };
}

/**
 * A figure Nixara computes itself from other figures in the data (a ratio of
 * two totals, a category's share of a total).
 *
 * Why this exists: the report prompt used to let the model do its own
 * arithmetic ("a percentage of two given figures"), while the checker only
 * accepts figures that literally exist in its fact index. So a correct 12.5%
 * margin was flagged as unverified, forcing a second model call and the
 * "double-checked" banner on nearly every report. Now Nixara computes these
 * figures, hands them to the model to copy, and puts the same figures in the
 * fact index, so the prompt and the checker agree.
 */
export interface DerivedFigure {
  kind: "ratio" | "share";
  /** Plain-language name, e.g. "Profit as % of Sales". */
  label: string;
  /** Percentage, 0-100 scale, rounded to 2 decimals. */
  value: number;
  /** How it was computed, shown to the reader, e.g. "total Profit / total Sales". */
  formula: string;
  /** For shares: the group this belongs to, e.g. "Share of total Sales by Category". */
  set?: string;
  /** For shares: the category value, e.g. "Technology". */
  item?: string;
}

const DERIVED_AMOUNT_TOKENS = new Set(
  ["profit", "revenue", "sales", "income", "earnings"].map(singularize)
);

function round2d(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Bounded and general (no per-dataset special cases): at most 6 ratios among
 * the first 4 sum-type business metrics, and shares of total for the first 2
 * low-cardinality categories x first 2 sum-type metrics (<= 80 shares).
 */
export function computeDerivedFigures(dataset: Dataset): DerivedFigure[] {
  const out: DerivedFigure[] = [];

  const sumMetrics: { col: string; total: number }[] = [];
  const candidates = businessMetricColumns(dataset);
  // Amount-like columns (profit, sales, ...) first, so the figures a finance
  // reader expects are the ones that make the cut when there are many metrics.
  const ordered = [
    ...candidates.filter((c) => tokenize(c).some((t) => DERIVED_AMOUNT_TOKENS.has(t))),
    ...candidates.filter((c) => !tokenize(c).some((t) => DERIVED_AMOUNT_TOKENS.has(t))),
  ];
  for (const col of ordered) {
    if (sumMetrics.length >= 4) break;
    const values = dataset.rows.map((r) => r[col]).filter((v): v is number => typeof v === "number");
    if (values.length === 0 || smartAgg(col, values) !== "sum") continue;
    sumMetrics.push({ col, total: numericStats(values).total });
  }

  // Ratios of totals, smaller over larger so each pair appears once (a
  // reciprocal like "Sales as 802% of Profit" is never useful).
  for (let i = 0; i < sumMetrics.length; i++) {
    for (let j = i + 1; j < sumMetrics.length; j++) {
      const a = sumMetrics[i];
      const b = sumMetrics[j];
      if (a.total === 0 || b.total === 0) continue;
      const [num, den] = Math.abs(a.total) <= Math.abs(b.total) ? [a, b] : [b, a];
      out.push({
        kind: "ratio",
        label: `${num.col} as % of ${den.col}`,
        value: round2d((num.total / den.total) * 100),
        formula: `total ${num.col} / total ${den.col}`,
      });
    }
  }

  // Shares of total, only where every group is non-negative: a "share" of a
  // mixed-sign total (profit with a loss-making category) can exceed 100% and
  // reads as nonsense.
  const cats = categoricalColumns(dataset)
    .filter((c) => {
      const u = new Set(dataset.rows.map((r) => r[c])).size;
      return u >= 2 && u <= 20;
    })
    .slice(0, 2);
  for (const cat of cats) {
    for (const m of sumMetrics.slice(0, 2)) {
      if (!(m.total > 0)) continue;
      const { points: groups } = aggregateBy(dataset, cat, m.col);
      if (groups.some((g) => g.value < 0)) continue;
      const set = `Share of total ${m.col} by ${cat}`;
      for (const g of groups) {
        out.push({
          kind: "share",
          label: `${g.key} share of total ${m.col}`,
          value: round2d((g.value / m.total) * 100),
          formula: `${g.key} ${m.col} / total ${m.col}`,
          set,
          item: g.key,
        });
      }
    }
  }

  return out;
}

export interface DashboardScoreReason {
  key:
    | "missingData"
    | "sparseColumn"
    | "gappyColumn"
    | "mixedTypeColumn"
    | "unusableColumns"
    | "noMeasurableMetric"
    | "noNumericData"
    | "noGroupingColumn"
    | "columnCount"
    | "rowCount";
  penalty: number;
  message: string;
}

export interface DashboardScoreBreakdown {
  score: number;
  missingRatio: number;
  /** Empty when nothing knocked the score down from 100. */
  reasons: DashboardScoreReason[];
}

/**
 * Mirrors dashboard_score: starts at 100, deducts for missing data / shape
 * issues. Returns the full breakdown (which deductions applied and the
 * human-readable reason for each) instead of only the final number -- the
 * upload-screen quality card and the Risk Report's Data Quality section both
 * need the reasons, and every one of them was already being computed here
 * and then thrown away. dashboardScore() below is a thin wrapper kept for
 * every caller that only ever wanted the number (buildDataSummary's text
 * block sent to the AI, primarily).
 */
/**
 * Placeholder tokens a real-world export commonly writes in place of a true
 * blank cell -- matched whole-value only (never a substring), case- and
 * whitespace-insensitive, so a legitimate category that merely CONTAINS one
 * of these words is never caught by accident.
 *
 * Only closes a gap for CATEGORICAL columns. A column cleanDataset() already
 * treats as numeric catches these for free: "NULL" or "N/A" sitting in an
 * otherwise-numeric column fails toNumberOrNull() and already becomes a real
 * `null` before either function below ever runs. The one real gap was the
 * same placeholder typed into a text/categorical column, which cleanDataset
 * has no reason to touch -- it survived as the literal string "N/A" and was
 * invisible to a check that only looked for null/undefined/"".
 */
export function dashboardScoreBreakdown(dataset: Dataset): DashboardScoreBreakdown {
  const { rows, columns } = dataset;
  const reasons: DashboardScoreReason[] = [];
  let missingRatio = 0;
  if (rows.length === 0 || columns.length === 0) return { score: 100, missingRatio, reasons };

  const roles = resolveColumnRoles(dataset);
  const metrics = columnsWithRole(dataset, "metric");
  const labels = columnsWithRole(dataset, "label");
  const unusable = columnsWithRole(dataset, "unusable");
  const used = [...metrics, ...labels];

  // ── The base: what can you actually do with this file? ───────────────────
  // REWRITTEN (2026-10). The previous version started every file at 100 and
  // subtracted for each flaw it found, independently and without a cap. That
  // shape produced a result that was not merely harsh but backwards:
  //
  //   coaster_db.csv  17/100   messy, but yields a working report
  //   a thin export   43/100   no usable metric at all, yields nothing
  //
  // A file you cannot analyse scored better than one you can, because the
  // thin file simply had fewer columns to find fault with. The flaws were
  // also double-counted: a 98%-blank column was penalised once in the
  // whole-file blank ratio and again as the worst single column.
  //
  // The score now starts from what the file supports and deducts for the
  // state of the columns an analysis will actually touch. Junk columns
  // sitting beside the usable ones still cost something, but they cost less
  // than a broken column you were going to rely on.
  let score: number;
  const hadCandidates = describeUnmeasuredColumns(dataset).length > 0;

  if (metrics.length > 0 && labels.length > 0) {
    score = 100;
  } else if (metrics.length > 0) {
    score = 70;
    reasons.push({
      key: "noGroupingColumn",
      penalty: 30,
      message:
        "There are figures to report but no column to break them down by, so no comparison and no chart is possible",
    });
  } else if (hadCandidates) {
    score = 30;
    reasons.push({
      key: "noMeasurableMetric",
      penalty: 70,
      message: `No column qualifies as an amount that can be totalled or averaged, so the report can only describe categories and gaps`,
    });
  } else {
    // A genuinely categorical file (survey answers, a list of names) is a
    // legitimate thing to upload and not a quality problem. It supports
    // counts, which is all it ever claimed to.
    score = 85;
    reasons.push({
      key: "noNumericData",
      penalty: 15,
      message: `This file holds no numbers, so the report can describe counts and categories but not amounts`,
    });
  }

  // ── Per-column facts, gathered once ──────────────────────────────────────
  let missing = 0;
  const blankShare = new Map<string, number>();
  for (const col of columns) {
    const info = roles.get(col);
    const blanks = Math.round((info?.blankShare ?? 0) * rows.length);
    missing += blanks;
    blankShare.set(col, info?.blankShare ?? 0);
  }
  missingRatio = missing / (rows.length * columns.length);

  const deduct = (key: DashboardScoreReason["key"], penalty: number, message: string) => {
    if (penalty <= 0) return;
    score -= penalty;
    reasons.push({ key, penalty, message });
  };

  // ── 1. The columns the analysis will actually use ────────────────────────
  // Weighted heaviest, because a gap here changes a figure someone acts on.
  const gappyUsed = used
    .filter((c) => (blankShare.get(c) ?? 0) >= 0.25)
    .sort((a, b) => (blankShare.get(b) ?? 0) - (blankShare.get(a) ?? 0));
  if (gappyUsed.length > 0) {
    const worst = gappyUsed[0];
    const share = blankShare.get(worst) ?? 0;
    const tier = share >= 0.8 ? 20 : share >= 0.5 ? 12 : 6;
    const extra = Math.min(9, (gappyUsed.length - 1) * 3);
    deduct("sparseColumn", tier + extra,
      `${worst} is ${Math.round(share * 100)}% blank, and it is one of the columns Nixara can report on` +
      (gappyUsed.length > 1
        ? `, as ${gappyUsed.length === 2 ? "is 1 other" : `are ${gappyUsed.length - 1} others`}`
        : ""));
  }

  // ── 2. Columns that exist but cannot be used ─────────────────────────────
  // Real, and worth saying, but a junk column you were never going to touch
  // is not the same kind of problem as a gap in the column you are reporting.
  const worstUnusable = unusable
    .slice()
    .sort((a, b) => (blankShare.get(b) ?? 0) - (blankShare.get(a) ?? 0))[0];
  if (worstUnusable && (blankShare.get(worstUnusable) ?? 0) >= 0.4) {
    const share = blankShare.get(worstUnusable) ?? 0;
    deduct("gappyColumn", share >= 0.8 ? 10 : share >= 0.6 ? 7 : 4,
      `${worstUnusable} is ${Math.round(share * 100)}% blank, so it holds nothing to report on` +
      (unusable.length > 1 ? `, and ${unusable.length - 1} other column${unusable.length === 2 ? "" : "s"} cannot be used either` : ""));
  }

  const mixed = unusable.filter((c) => {
    const info = roles.get(c);
    return info !== undefined && info.textShare >= 0.1 && info.numericShare >= 0.1;
  });
  if (mixed.length > 0) {
    deduct("mixedTypeColumn", Math.min(14, 8 + (mixed.length - 1) * 3),
      `${mixed[0]} holds both text and numbers in the same column` +
      (mixed.length > 1 ? `, as do ${mixed.length - 1} other${mixed.length === 2 ? "" : "s"}` : "") +
      `, so it cannot be totalled or used as a label`);
  }

  const unusableShare = unusable.length / columns.length;
  if (unusableShare > 0.25) {
    deduct("unusableColumns", unusableShare > 0.5 ? 10 : 5,
      `${unusable.length} of ${columns.length} columns hold nothing Nixara can measure or group by`);
  }

  // ── 3. Whole-file gaps, capped, and no longer the main signal ────────────
  // Still worth one line, because a reader scanning the file sees the blanks.
  // Small on purpose: the columns that matter are already covered above, and
  // charging the same blank cell twice is what produced the 17/100.
  if (missingRatio > 0.35) deduct("missingData", 10, `${(missingRatio * 100).toFixed(1)}% of all cells in the file are blank`);
  else if (missingRatio > 0.2) deduct("missingData", 6, `${(missingRatio * 100).toFixed(1)}% of all cells in the file are blank`);
  else if (missingRatio > 0.08) deduct("missingData", 3, `${(missingRatio * 100).toFixed(1)}% of all cells in the file are blank`);

  // ── 4. Shape ─────────────────────────────────────────────────────────────
  // 40, not 20: a 21-column business export is ordinary, and charging it 10
  // points was noise. Past 40 the file is wide enough to be hard to read and
  // to risk the summary budget.
  if (columns.length > 40) deduct("columnCount", 5, `${columns.length} columns is wide enough to make a focused report harder`);
  if (rows.length < 10) deduct("rowCount", 10, `Only ${rows.length} row${rows.length === 1 ? "" : "s"}, too few for reliable patterns`);

  return { score: Math.max(score, 0), missingRatio, reasons };
}

/** Mirrors dashboard_score: starts at 100, deducts for missing data / shape issues. */
export function dashboardScore(dataset: Dataset): number {
  return dashboardScoreBreakdown(dataset).score;
}

/** One column's worth of a specific, genuine data-integrity issue. */
export interface ColumnIssue {
  column: string;
  count: number;
  detail: string;
}

/**
 * Per-column missing-value breakdown — a companion to dashboardScoreBreakdown()'s
 * missingData reason, which only reports ONE blended percentage across the
 * whole dataset. This is genuinely additive, not a repeat: "8.2% of cells are
 * missing" tells you nothing about WHICH column to go fix; this does.
 */
export function detectMissingValuesByColumn(dataset: Dataset): ColumnIssue[] {
  const { rows, columns } = dataset;
  if (rows.length === 0) return [];

  const issues: ColumnIssue[] = [];
  for (const col of columns) {
    let missing = 0;
    for (const row of rows) {
      if (isMissingValue(row[col])) missing++;
    }
    if (missing === 0) continue;
    const pct = (missing / rows.length) * 100;
    issues.push({
      column: col,
      count: missing,
      detail: `${missing.toLocaleString()} blank cell${missing === 1 ? "" : "s"} (${pct.toFixed(1)}% of this column)`,
    });
  }
  return issues.sort((a, b) => b.count - a.count);
}

const VALID_ID_CHARS = /^[A-Za-z0-9\-_.]+$/;

/**
 * Flags identifier-shaped columns (reusing NON_METRIC_PATTERNS — the same
 * "this looks like an ID, not a metric" heuristic already used by
 * businessMetricColumns()) where a MINORITY of values contain characters an
 * ID shouldn't (stray punctuation, "#", "N/A" text, etc.).
 *
 * Deliberately not a Statistical Outliers detector wearing a different name.
 * A negative Profit Margin or an unusually large Quantity is a real business
 * fact that happens to be numerically unusual — not a data-integrity problem,
 * and the Risk Report prompt already says so explicitly ("detected outliers
 * reflect business patterns — treat as signals, not data errors"). This
 * function only ever looks at whether a value is a VALID SHAPE for a column
 * that is supposed to hold clean identifiers, never at whether a numeric
 * value is unusually large or small.
 *
 * The <50% minority check matters: if most values in a column don't look
 * like a clean ID, the column probably isn't actually an ID despite its
 * name, and flagging it would be a false signal, not a real one.
 */
export function detectMalformedEntries(dataset: Dataset): ColumnIssue[] {
  const { rows, columns } = dataset;
  if (rows.length === 0) return [];

  // BUG FIX (2026-10): this tested the RAW column name, so "_" being a word
  // character meant /\bid\b/ never matched "Student_ID" and id-integrity
  // checking silently never ran on any snake_case export -- which is most
  // database dumps. The name normalization added to isNonMetricName was never
  // applied here, the same fix-at-one-call-site pattern the role resolver
  // exists to end. Both the normalized name hint and the resolved identifier
  // role count now, so a text id column and a numeric one are both checked.
  const roles = resolveColumnRoles(dataset);
  const idLikeColumns = columns.filter(
    (col) => nameSuggestsIdentifier(col) || roles.get(col)?.role === "identifier"
  );
  const issues: ColumnIssue[] = [];

  for (const col of idLikeColumns) {
    let malformed = 0;
    let present = 0;
    for (const row of rows) {
      const v = row[col];
      if (v === null || v === undefined || v === "") continue;
      present++;
      if (typeof v === "number") continue; // a clean numeric ID is not malformed
      if (!VALID_ID_CHARS.test(String(v).trim())) malformed++;
    }
    if (present === 0 || malformed === 0) continue;
    if (malformed / present >= 0.5) continue; // looks like free text, not a broken ID column

    issues.push({
      column: col,
      count: malformed,
      detail: `${malformed} ${malformed === 1 ? "row contains" : "rows contain"} unexpected characters instead of a valid value`,
    });
  }
  return issues.sort((a, b) => b.count - a.count);
}

/**
 * Aggregation vocabulary, stored as TOKENS rather than substrings.
 *
 * BUG FIX (2026-09): matching was `colName.toLowerCase().includes(keyword)`,
 * which matches anywhere inside a word. "count" is a SUM keyword, and
 * "Discount" contains it, so smartAgg("Discount") returned "sum" and the app
 * summed a discount RATE across every row in a group - producing figures like
 * "Discount by Region = 219.4" for a column whose values are 0 to 0.8. The
 * Risk and Operational prompts then explicitly ask the model to cite discount
 * percentages as business metrics, so the nonsense number went straight into
 * the report. superstore_data.csv, the sample file the README tells people to
 * try first, has a Discount column, so this was reachable in the demo.
 *
 * Same class of false positive: "Headcount" and "Account Balance" both
 * contain "count"; "Percentage" contains "age".
 *
 * Fixed by tokenising the column name (the same camelCase / snake_case /
 * punctuation split and singulariser used for chart-column relevance) and
 * requiring a whole-token match. Sets are built through singularize() so the
 * keyword and the parsed token are normalised identically.
 *
 * Note what is deliberately NOT in either list: "discount". Left unmatched,
 * a bare "Discount" falls through to the mean default (right - it is a rate),
 * while "Discount Amount" still matches "amount" and sums (also right), and
 * "Discount Rate" matches "rate" and averages. Adding it to MEAN_KEYWORDS
 * would break the "Discount Amount" case, since mean is checked first.
 */
const SUM_KEYWORDS = new Set(
  [
    "sales", "revenue", "profit", "income", "earnings", "cost", "costs", "price",
    "amount", "total", "spend", "spending", "expense", "expenses", "budget",
    "quantity", "qty", "units", "volume", "billing", "charge", "charges", "fee",
    "fees", "payment", "payments", "count", "visits", "orders", "transactions",
    // Additive things whose names are single compound words, so they can no
    // longer be caught by a substring match on "count" and friends.
    "headcount", "hours", "items", "tickets", "claims", "invoices",
  ].map(singularize)
);

const MEAN_KEYWORDS = new Set(
  [
    "average", "avg", "mean", "rate", "ratio", "margin", "score", "pct", "percent",
    "percentage", "age", "duration", "tenure", "bmi", "height", "weight", "index",
    "level", "days", "years", "months", "rating", "satisfaction", "length",
    "distance", "temperature", "speed", "density", "concentration",
  ].map(singularize)
);

function matchesVocabulary(tokens: string[], vocabulary: Set<string>): boolean {
  return tokens.some((token) => vocabulary.has(token));
}

/**
 * True when a column's values look like proportions rather than amounts:
 * everything sits in [0, 1] and a meaningful share of them are fractional.
 *
 * This is the backstop for the problem the 2026-08 note below describes - that
 * no keyword list will ever cover every column name across every industry. A
 * name-based guess can be wrong; values in [0, 1] with decimals are almost
 * never something you add up. Requires a reasonable sample so a handful of
 * rows cannot trip it, and excludes negatives so that a genuinely additive
 * metric which happens to dip below zero is never caught.
 */
export function looksLikeProportion(values: number[]): boolean {
  if (values.length < 8) return false;
  let fractional = 0;
  for (const v of values) {
    if (v < 0 || v > 1) return false;
    if (!Number.isInteger(v)) fractional++;
  }
  return fractional / values.length >= 0.3;
}

/**
 * BUG FIX (2026-08): this used to default to "sum" for any column that didn't
 * match a short "mean-like" keyword list - which meant a column like "Age"
 * (not on the list) got summed across every row in a group, producing
 * meaningless totals like 1,430,368 instead of an average. A hardcoded
 * keyword list will never cover every possible per-entity attribute name
 * across every industry Nixara sees data from (age, BMI, tenure, GPA,
 * rating, days-since...), so instead of trying to enumerate all of them,
 * the fallback for an *unrecognized* column name is now "mean" - the safer
 * assumption for an arbitrary numeric column - and only the smaller, more
 * stable vocabulary of clearly-additive business terms (sales, cost,
 * quantity, count...) triggers "sum".
 *
 * Order matters. An explicit mean-like name wins outright. Then the value
 * shape gets a veto, so a column named like an amount but shaped like a rate
 * is averaged. Then explicit sum-like names. Then the mean default.
 *
 * @param values Optional sample of the column's numeric values. Callers that
 *   already walk the column should pass them; the decision is strictly better
 *   with them and unchanged in behaviour without.
 */
export function smartAgg(colName: string, values?: number[]): "mean" | "sum" {
  const tokens = tokenize(colName);

  if (matchesVocabulary(tokens, MEAN_KEYWORDS)) return "mean";
  if (values && looksLikeProportion(values)) return "mean";
  if (matchesVocabulary(tokens, SUM_KEYWORDS)) return "sum";
  return "mean";
}

export interface AggregatedPoint {
  key: string;
  value: number;
  /** Rows in this group that carried a usable number. */
  used: number;
  /** Rows in this group altogether. */
  total: number;
}

export interface AggregateResult {
  agg: "mean" | "sum";
  points: AggregatedPoint[];
  /** Rows across every group that contributed to a value. */
  used: number;
  /** Rows across every group, whether they contributed or not. */
  total: number;
}

/**
 * BUG FIX (2026-10): this returned only {key, value} and silently dropped
 * every row whose value was not a number. A mean over 104 of 668 rows was
 * indistinguishable from a mean over all 668, on the chart, in the tooltip
 * and in the summary handed to the model.
 *
 * It now counts what it skipped and reports it, so a thin figure can be shown
 * as thin instead of being presented as the whole group. The aggregation it
 * chose is returned too: it was already decided here and then thrown away,
 * which is why chart titles could not say whether they showed a total or an
 * average.
 */
export function aggregateBy(
  dataset: Dataset,
  groupCol: string,
  valueCol: string
): AggregateResult {
  const groups = new Map<string, { values: number[]; total: number }>();
  // Collected in the pass we already make, so passing the value shape to
  // smartAgg costs nothing extra.
  const allValues: number[] = [];
  let total = 0;

  for (const row of dataset.rows) {
    const raw = row[groupCol];
    const key = raw instanceof Date ? formatDateSafe(raw) : String(raw ?? "—");
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = { values: [], total: 0 };
      groups.set(key, bucket);
    }
    // Counted whether or not the value is usable: that is the whole point.
    bucket.total++;
    total++;

    const v = row[valueCol];
    if (typeof v !== "number") continue;
    allValues.push(v);
    bucket.values.push(v);
  }

  const agg = smartAgg(valueCol, allValues);

  const points = Array.from(groups.entries())
    .filter(([, b]) => b.values.length > 0)
    .map(([key, b]) => ({
      key,
      value: agg === "mean" ? mean(b.values) : b.values.reduce((a, c) => a + c, 0),
      used: b.values.length,
      total: b.total,
    }))
    .sort((a, b) => b.value - a.value);

  return { agg, points, used: allValues.length, total };
}

export interface ScatterPoint {
  x: number;
  y: number;
}

export interface ChartSpec {
  type: "bar" | "pie" | "area" | "treemap" | "scatter" | "groupedBar";
  title: string;
  /**
   * Human-readable label for the metric this chart's values represent --
   * used as the Bar/Area series `name` in Charts.tsx. Recharts falls back to
   * the literal dataKey ("value") as the tooltip/legend label when no `name`
   * is given, which is why hovering a bar previously showed "value : 12.95"
   * instead of e.g. "Years Experience : 12.95".
   */
  metricLabel: string;
  /** Which operation produced these values. Shown in the title and tooltip. */
  agg: "mean" | "sum";
  /** Rows that contributed across the whole chart, and rows considered. */
  coverage: { used: number; total: number };
  data: AggregatedPoint[];
  /**
   * What the chart had to do to fit, in plain English: categories collapsed
   * into "Other", or a different column used than the one the question asked
   * for. Null when the chart shows exactly what was asked for.
   *
   * Added 2026-10. A user typing "Location" against a file with 280 of them
   * got a chart of Status instead, with nothing saying why. Substituting
   * silently is the same fault as refusing silently.
   */
  note: string | null;
  /**
   * The unit stripped from this metric's values at parse time ("mph", "kg",
   * "°"), so the axis and tooltip can put it back. Without it a bar reading
   * 93 does not say 93 of what. See number-format.ts.
   */
  unit: string | null;
  /**
   * Only for type "scatter": the paired values behind a correlation the
   * engine already computed. TOP CORRELATIONS has been in the model's
   * summary for months and the user never saw it, even though "these two
   * move together" is one of the few things a chart shows better than a
   * sentence.
   */
  scatter?: {
    x: string;
    y: string;
    r: number;
    n: number;
    points: ScatterPoint[];
  } | null;
  /**
   * Only for type "groupedBar": one bar per series inside each category.
   * Built from the same cross-breakdown the summary already sends the model.
   */
  groups?: {
    names: string[];
    rows: Record<string, string | number>[];
  } | null;
}

/**
 * Turns a raw column name into a human-readable label for DISPLAY ONLY
 * (chart titles, tooltip/legend names) -- never used for data lookups,
 * which must keep using the dataset's real column names verbatim.
 *
 * Only capitalizes a word's first letter when it's currently lowercase, and
 * never forces the rest of a word to lowercase -- so "years_experience"
 * becomes "Years Experience", but an already-clean name like "Profit Margin"
 * passes through unchanged and an acronym or proper noun inside a name
 * (e.g. "Customer ID", "State/Province") is never mangled.
 */
export function humanizeColumnName(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w[0] === w[0].toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Aggregates a metric by month for any Date-typed column, regardless of how
 * granular the source timestamps are (a per-second admission timestamp
 * column can have tens of thousands of distinct raw values — far too many
 * to chart directly, but perfectly readable once bucketed to month).
 */
export function bucketByMonth(
  dataset: Dataset,
  dateCol: string,
  valueCol: string
): AggregatedPoint[] {
  const groups = new Map<string, { values: number[]; total: number }>();
  const sortKeys = new Map<string, number>();
  const allValues: number[] = [];

  for (const row of dataset.rows) {
    const d = row[dateCol];
    if (!(d instanceof Date)) continue;
    const key = monthBucketKey(d);
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = { values: [], total: 0 };
      groups.set(key, bucket);
      sortKeys.set(key, monthBucketSortKey(d));
    }
    // Counted even when the value is unusable, so the month's coverage is real.
    bucket.total++;

    const v = row[valueCol];
    if (typeof v !== "number") continue;
    allValues.push(v);
    bucket.values.push(v);
  }

  const agg = smartAgg(valueCol, allValues);

  return Array.from(groups.entries())
    .filter(([, b]) => b.values.length > 0)
    .map(([key, b]) => ({
      key,
      value: agg === "mean" ? mean(b.values) : b.values.reduce((a, c) => a + c, 0),
      used: b.values.length,
      total: b.total,
    }))
    .sort((a, b) => sortKeys.get(a.key)! - sortKeys.get(b.key)!);
}

/** Finds a Date-typed column with enough distinct months to make a real trend line. */
/**
 * The date column worth drawing a trend from: the best-populated one, not
 * the first one in the file.
 *
 * coaster_db.csv has three date columns. "Soft opening date" comes first and
 * is about 5% filled, so the old first-match loop drew a trend over time from
 * one row in twenty and said nothing about it. The column that covers the
 * most rows is the one a trend should be built on.
 */
function findDateColumn(dataset: Dataset): string | null {
  let best: string | null = null;
  let bestFilled = 0;
  for (const col of dataset.columns) {
    if (!isDateColumn(dataset.rows, col)) continue;
    const dates = dataset.rows.map((r) => r[col]).filter((v): v is Date => v instanceof Date);
    if (new Set(dates.map((d) => monthBucketKey(d))).size < 2) continue;
    if (dates.length > bestFilled) {
      bestFilled = dates.length;
      best = col;
    }
  }
  // A trend drawn from a handful of rows is not a trend. Half the file is a
  // low bar, but it rules out the 5%-populated column that used to win.
  return bestFilled >= dataset.rows.length * 0.5 ? best : null;
}

/**
 * Picks which chart type(s) to render, based on the actual shape of the
 * selected data rather than always defaulting to a bar chart:
 *
 *  - A Date-typed column with a real month range → area chart (trend over time)
 *  - A category with 2–6 values, all non-negative → pie chart (composition of a whole)
 *  - A category with >12 values (up to selectChartColumns' 25-value cap) and
 *    no negatives → treemap (readable at higher cardinality than a bar list)
 *  - Everything else → bar chart (the most broadly correct default —
 *    handles negatives, mid-range cardinality, and any category type)
 *
 * Returns up to `maxCharts` specs, preferring a time-series view first (when
 * one exists) and a category breakdown second, using a different metric for
 * each when two relevant metrics are available so the two charts are
 * complementary rather than redundant.
 */
/**
 * Every column Nixara declined to use as a metric, and why.
 *
 * The decision itself already happens in businessMetricColumns(); this records
 * the reasoning, which was previously discarded. Without it a column that
 * charted yesterday simply disappears, and the natural reading is that the app
 * broke rather than that it declined to average a sixth of the rows.
 *
 * Only columns that LOOK like candidates are reported. A pure text column was
 * never going to be a metric and saying so is noise; this is for columns that
 * carry at least one number and still did not qualify.
 */
export type UnmeasuredReason = "mixed" | "sparse" | "not-a-quantity" | "identifier";

export interface UnmeasuredColumn extends ColumnIssue {
  reason: UnmeasuredReason;
  /** Shares of the column, 0 to 1, for the mix bar. */
  mix: { text: number; numeric: number; blank: number };
}

export function describeUnmeasuredColumns(dataset: Dataset): UnmeasuredColumn[] {
  const total = dataset.rows.length;
  if (total === 0) return [];

  // The reason each column was set aside is no longer re-derived here. The
  // resolver already decided the role AND recorded why, so this reads them
  // instead of running a second, slightly different set of tests that could
  // (and did) disagree with the one that actually excluded the column.
  const roles = resolveColumnRoles(dataset);
  const out: UnmeasuredColumn[] = [];

  for (const col of dataset.columns) {
    const info = roles.get(col);
    if (!info || info.role === "metric") continue;
    // Never a candidate in the first place: a column with no numbers at all
    // was never going to be a metric, and saying so is noise.
    if (info.numericShare === 0 && info.role !== "date") continue;

    let reason: UnmeasuredReason;
    if (info.role === "identifier") {
      reason = /coordinates|calendar years/.test(info.reason) ? "not-a-quantity" : "identifier";
    } else if (info.role === "date") {
      reason = "not-a-quantity";
    } else if (info.textShare >= 0.1 && info.numericShare > 0) {
      reason = "mixed";
    } else {
      reason = "sparse";
    }

    out.push({
      column: col,
      count: Math.round((1 - info.numericShare) * total),
      detail: info.reason,
      reason,
      mix: { text: info.textShare, numeric: info.numericShare, blank: info.blankShare },
    });
  }

  // Worst first: the most nearly-usable columns are the ones a reader is most
  // likely to be looking for.
  const rank: Record<UnmeasuredReason, number> = { mixed: 0, sparse: 1, "not-a-quantity": 2, identifier: 3 };
  return out.sort((a, b) => rank[a.reason] - rank[b.reason] || b.mix.numeric - a.mix.numeric);
}

/** "Total" or "Average of", for the front of a chart title. */
export function aggWord(agg: "mean" | "sum"): string {
  return agg === "sum" ? "Total" : "Average of";
}

/**
 * Most categories a chart will draw before the rest are grouped as "Other".
 *
 * Previously a label column with more than 25 distinct values was simply
 * skipped, and the picker fell through to whatever column did fit. On
 * coaster_db that meant 14 of 18 label columns -- Location with 280 values,
 * Manufacturer with 103, Designer with 154 -- could never be charted, and
 * asking for any of them silently produced a chart of Status. Collapsing the
 * tail is what a person would do by hand, and it keeps the biggest
 * categories, which are the ones being asked about.
 */
const MAX_CHART_CATEGORIES = 15;

/**
 * Keeps the largest categories and rolls the rest into one "Other" bar.
 *
 * The Other bar is aggregated the same way as the rest, which for an average
 * means weighting by how many rows each collapsed category contributed --
 * averaging the averages would silently give a 2-row category the same
 * weight as a 2,000-row one.
 */
function collapseTail(
  points: AggregatedPoint[],
  agg: "mean" | "sum",
  limit = MAX_CHART_CATEGORIES
): { points: AggregatedPoint[]; collapsed: number } {
  if (points.length <= limit) return { points, collapsed: 0 };

  const ranked = [...points].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const kept = ranked.slice(0, limit - 1);
  const rest = ranked.slice(limit - 1);

  const used = rest.reduce((n, p) => n + p.used, 0);
  const total = rest.reduce((n, p) => n + p.total, 0);
  const value =
    agg === "sum"
      ? rest.reduce((n, p) => n + p.value, 0)
      : used > 0
        ? rest.reduce((n, p) => n + p.value * p.used, 0) / used
        : 0;

  return {
    points: [...kept, { key: `Other (${rest.length})`, value, used, total }],
    collapsed: rest.length,
  };
}

export interface ChartableColumn {
  column: string;
  distinct: number;
  /** Whether a chart of this column has to collapse its tail into "Other". */
  collapses: boolean;
}

/**
 * What the user can ask a chart to break down by, and how big each one is.
 *
 * Added 2026-10 in answer to a direct question: typing "Location" produced a
 * chart of Status instead, and there was no way to know from the screen
 * which columns would work. Every label column is now chartable, so this is
 * no longer a list of what is allowed; it is a list of what exists, with the
 * size of each, so a reader can tell that Location has 280 values and will
 * therefore be shown as a top-15 plus Other.
 *
 * Ordered by how well each reads as an axis, which is the order a person
 * would try them in.
 */
export function chartableColumns(dataset: Dataset): ChartableColumn[] {
  return groupingColumns(dataset)
    .map((column) => {
      const distinct = roleInfo(dataset, column)?.distinct ?? 0;
      return { column, distinct, collapses: distinct > MAX_CHART_CATEGORIES };
    })
    .sort((a, b) => chartability(dataset, b.column) - chartability(dataset, a.column));
}

/**
 * A scatter of the strongest relationship between two metrics.
 *
 * pairwiseCorrelation has fed TOP CORRELATIONS in the model's summary for
 * months, and nothing ever put it on screen. "These two move together" is
 * one of the few claims a picture makes better than a sentence, and a
 * scatter is the only form that lets a reader see whether the relationship
 * is real or an artifact of three outliers.
 *
 * Only metric columns are paired, which is what keeps Row ID out: before the
 * role resolver, the summary's own correlation block was reporting
 * "Row ID ~ Sales: 1.000" as the file's strongest finding.
 */
function pickScatter(dataset: Dataset): ChartSpec | null {
  const metrics = businessMetricColumns(dataset);
  if (metrics.length < 2) return null;

  let best: { a: string; b: string; r: number; n: number } | null = null;
  for (let i = 0; i < metrics.length; i++) {
    for (let j = i + 1; j < metrics.length; j++) {
      const result = pairwiseCorrelation(dataset.rows, metrics[i], metrics[j]);
      if (!result || result.n < 10) continue;
      // A correlation this close to 1 is almost always the same measurement
      // twice, not a finding: coaster_db pairs Inversions with
      // Inversions_clean at exactly 1.00, and the chart would tell the
      // reader nothing except that their file has a duplicate column.
      if (Math.abs(result.r) >= 0.98) continue;
      if (!best || Math.abs(result.r) > Math.abs(best.r)) {
        best = { a: metrics[i], b: metrics[j], r: result.r, n: result.n };
      }
    }
  }
  // Below this the cloud is a blob and the chart says nothing a reader can
  // act on, which is worse than showing no chart.
  if (!best || Math.abs(best.r) < 0.3) return null;

  const points: ScatterPoint[] = [];
  for (const row of dataset.rows) {
    const x = row[best.a];
    const y = row[best.b];
    if (typeof x !== "number" || typeof y !== "number") continue;
    points.push({ x, y });
  }
  // A browser does not need 50,000 dots to show a shape, and painting them
  // all is what makes a chart feel broken. Evenly sampled, never head-sliced,
  // so the sample is not just the first months of the file.
  const MAX_POINTS = 600;
  const sampled =
    points.length <= MAX_POINTS
      ? points
      : points.filter((_, i) => i % Math.ceil(points.length / MAX_POINTS) === 0);

  const strength = Math.abs(best.r) >= 0.7 ? "move together closely" : "tend to move together";
  const direction = best.r < 0 ? "in opposite directions" : "";
  return {
    type: "scatter",
    title: `${humanizeColumnName(best.a)} against ${humanizeColumnName(best.b)}`,
    metricLabel: humanizeColumnName(best.b),
    agg: "mean",
    coverage: { used: best.n, total: dataset.rows.length },
    data: [],
    note:
      `These two ${strength}${direction ? " " + direction : ""} (correlation ${best.r.toFixed(2)} across ${best.n.toLocaleString()} rows). ` +
      `Moving together is not proof that one causes the other.` +
      (sampled.length < points.length ? ` Showing ${sampled.length.toLocaleString()} of ${points.length.toLocaleString()} points.` : ""),
    unit: null,
    scatter: { x: best.a, y: best.b, r: best.r, n: best.n, points: sampled },
  };
}

/**
 * A grouped bar of one metric across two categories at once.
 *
 * buildDataSummary has computed a CROSS-BREAKDOWN (Region x Category) for
 * the model since long before this, and the user never saw it. "Which
 * category is weak in which region" is a question a single-axis bar chart
 * cannot answer at all.
 *
 * Capped at four series, which is the point the dataviz guidance calls the
 * ceiling for telling adjacent bars apart by colour; past it this returns
 * nothing rather than generating a fifth hue nobody can distinguish.
 */
function pickGroupedBar(dataset: Dataset, exclude: string | null): ChartSpec | null {
  const labels = groupingColumns(dataset).filter((c) => {
    const d = roleInfo(dataset, c)?.distinct ?? 0;
    return d >= 2 && d <= 6;
  });
  const metrics = businessMetricColumns(dataset);
  if (labels.length < 2 || metrics.length === 0) return null;

  // The column with MORE values goes on the axis and the one with fewer
  // becomes the series. The other way round produces four coloured series
  // over two bars, which is a legend doing the work the axis should.
  const byWidth = [...labels].sort(
    (a, b) => (roleInfo(dataset, b)?.distinct ?? 0) - (roleInfo(dataset, a)?.distinct ?? 0)
  );
  const outer = byWidth[0];
  const inner = byWidth.find((c) => c !== outer);
  if (!inner) return null;
  void exclude;
  const metric = metrics[0];

  const seriesNames = [...new Set(dataset.rows.map((r) => String(r[inner] ?? "")))]
    .filter((v) => v !== "")
    .sort();
  if (seriesNames.length < 2 || seriesNames.length > 4) return null;

  const how = smartAgg(metric, dataset.rows.map((r) => r[metric]).filter((v): v is number => typeof v === "number"));
  const buckets = new Map<string, Map<string, number[]>>();
  for (const row of dataset.rows) {
    const o = String(row[outer] ?? "");
    const i = String(row[inner] ?? "");
    const v = row[metric];
    if (o === "" || i === "" || typeof v !== "number") continue;
    if (!buckets.has(o)) buckets.set(o, new Map());
    const inner2 = buckets.get(o)!;
    if (!inner2.has(i)) inner2.set(i, []);
    inner2.get(i)!.push(v);
  }
  if (buckets.size < 2) return null;

  const rows: Record<string, string | number>[] = [];
  for (const [o, inner2] of buckets) {
    const row: Record<string, string | number> = { key: o };
    for (const name of seriesNames) {
      const vals = inner2.get(name) ?? [];
      row[name] = vals.length === 0 ? 0 : how === "sum" ? vals.reduce((a, b) => a + b, 0) : mean(vals);
    }
    rows.push(row);
  }
  rows.sort((a, b) =>
    seriesNames.reduce((n, s) => n + Number(b[s] ?? 0), 0) -
    seriesNames.reduce((n, s) => n + Number(a[s] ?? 0), 0)
  );

  const kept = rows.slice(0, MAX_CHART_CATEGORIES);
  return {
    type: "groupedBar",
    title: `${aggWord(how)} ${humanizeColumnName(metric)} by ${humanizeColumnName(outer)} and ${humanizeColumnName(inner)}`,
    metricLabel: humanizeColumnName(metric),
    agg: how,
    coverage: { used: dataset.rows.length, total: dataset.rows.length },
    data: [],
    note:
      kept.length < rows.length
        ? `Showing the ${kept.length} largest of ${rows.length} ${humanizeColumnName(outer)} values.`
        : null,
    unit: dataset.numberFormats?.[metric]?.traits.unit ?? null,
    groups: { names: seriesNames, rows: kept },
  };
}

export function pickChartSpecs(dataset: Dataset, decisionText: string, maxCharts = 2): ChartSpec[] {
  const { category, metrics, asked } = selectChartColumns(dataset, decisionText);
  const specs: ChartSpec[] = [];
  const primaryMetric = metrics[0];

  const dateCol = findDateColumn(dataset);
  if (dateCol && primaryMetric) {
    const bucketed = bucketByMonth(dataset, dateCol, primaryMetric);
    if (bucketed.length >= 2) {
      const how = smartAgg(primaryMetric, bucketed.map((d) => d.value));
      const data = bucketed;
      const used = data.reduce((n, d) => n + d.used, 0);
      const total = data.reduce((n, d) => n + d.total, 0);
      specs.push({
        type: "area",
        title: `${aggWord(how)} ${humanizeColumnName(primaryMetric)} over time, by ${humanizeColumnName(dateCol)}`,
        metricLabel: humanizeColumnName(primaryMetric),
        agg: how,
        coverage: { used, total },
        data,
        note: null,
        unit: dataset.numberFormats?.[primaryMetric]?.traits.unit ?? null,
      });
    }
  }

  if (category && primaryMetric && specs.length < maxCharts) {
    const metric = specs.length > 0 && metrics[1] ? metrics[1] : primaryMetric;
    const { agg: how, points: all, used, total } = aggregateBy(dataset, category, metric);
    const { points: data, collapsed } = collapseTail(all, how);
    const cardinality = data.length;
    const hasNegative = data.some((d) => d.value < 0);

    // Say what the chart had to do to fit, and say when the question asked
    // for a column the chart could not use.
    const notes: string[] = [];
    if (collapsed > 0) {
      notes.push(
        `Showing the ${data.length - 1} largest of ${all.length} ${humanizeColumnName(category)} values; the remaining ${collapsed} are grouped as Other.`
      );
    }
    if (asked && asked !== category) {
      notes.push(`You asked about ${humanizeColumnName(asked)}, which cannot be charted here, so this is ${humanizeColumnName(category)}.`);
    }

    /**
     * BUG FIX (2026-10): shape was chosen from cardinality alone, so an
     * average could land in a pie. A pie says its slices are parts of one
     * whole; averages are not parts of anything, and the coaster chart's six
     * slices summed to 11,837.79, a number that means nothing. Pie and
     * treemap are now reachable only when the values are totals.
     */
    let type: ChartSpec["type"] = "bar";
    if (how === "sum" && !hasNegative) {
      if (cardinality >= 2 && cardinality <= 6) type = "pie";
      else if (cardinality > 12) type = "treemap";
    }

    specs.push({
      type,
      title: `${aggWord(how)} ${humanizeColumnName(metric)} by ${humanizeColumnName(category)}`,
      metricLabel: humanizeColumnName(metric),
      agg: how,
      coverage: { used, total },
      data,
      note: notes.length > 0 ? notes.join(" ") : null,
      unit: dataset.numberFormats?.[metric]?.traits.unit ?? null,
    });
  }

  // Two charts built from figures the engine already computed for the model
  // and never put on screen. Both are added last, so they fill remaining
  // slots rather than displacing the breakdown a user asked for.
  if (specs.length < maxCharts) {
    const grouped = pickGroupedBar(dataset, category);
    if (grouped) specs.push(grouped);
  }
  if (specs.length < maxCharts) {
    const scatter = pickScatter(dataset);
    if (scatter) specs.push(scatter);
  }

  return specs.slice(0, maxCharts);
}

/**
 * Pearson correlation over PAIRWISE-COMPLETE observations.
 *
 * BUG FIX (2026-09): the previous implementation built the two value arrays
 * independently -
 *
 *     const av = rows.map(r => r[a]).filter(isNumber);
 *     const bv = rows.map(r => r[b]).filter(isNumber);
 *     const n  = Math.min(av.length, bv.length);
 *     // ...then paired av[k] with bv[k]
 *
 * - and then zipped them by index. Each filter removes a DIFFERENT set of
 * rows, so as soon as the two columns have missing values in different places
 * the pairs are shifted relative to each other and every subsequent value is
 * matched against the wrong row. The result is not a noisy correlation, it is
 * a correlation between two series that never coexisted. With a real dataset
 * (missing values are the norm) the number was arbitrary, and it was reported
 * to three decimal places, which reads as precision.
 *
 * Now a row contributes only when BOTH columns are numeric on that row, which
 * is the standard pairwise-complete treatment.
 *
 * Returns null when there is not enough overlap to say anything. `n` is
 * returned alongside `r` and printed in the summary because a correlation over
 * 12 of 200,000 rows and one over all 200,000 are not the same claim, and the
 * old output made them indistinguishable.
 */
export function pairwiseCorrelation(
  rows: Row[],
  colA: string,
  colB: string,
  minPairs = 10
): { r: number; n: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];

  for (const row of rows) {
    const x = row[colA];
    const y = row[colB];
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs.push(x);
    ys.push(y);
  }

  const n = xs.length;
  if (n < minPairs) return null;

  const mx = mean(xs);
  const my = mean(ys);

  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let k = 0; k < n; k++) {
    const a = xs[k] - mx;
    const b = ys[k] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }

  const denom = Math.sqrt(dx * dy);
  if (denom === 0) return null; // at least one column is constant

  return { r: num / denom, n };
}

/**
 * Dollar-amount-shaped column names: profit/revenue/sales/income/earnings.
 * A column must ALSO be sum-typed (aggTypeOf === "sum") to count as a real
 * amount column -- see rankedBusinessMetrics() below for why ("Profit
 * Margin" tokenizes to include "profit" but is mean-typed, a ratio).
 */
const AMOUNT_TOKENS = new Set(
  ["profit", "revenue", "sales", "income", "earnings"].map(singularize)
);

/**
 * The business-metric columns of a dataset (see businessMetricColumns),
 * ranked so dollar-amount columns (profit/revenue/income/...) come first,
 * then other additive (sum-type) columns, then everything else (mean-type).
 *
 * This is the SINGLE ranking both buildDataSummary() below (which metrics
 * the model sees first, and in what order, in BREAKDOWN/CROSS-BREAKDOWN/
 * TOP-BOTTOM sections) and buildEvidenceFacts() in lib/evidence.ts (which
 * metrics it builds category-crossed verification facts for) use.
 *
 * BUG FIX (2026-10): those two call sites used to rank independently --
 * buildDataSummary put profit-like columns first, but buildEvidenceFacts
 * just took businessMetricColumns() in raw left-to-right column order and
 * capped at 4. On a dataset where the metric that actually matters (e.g. a
 * cost or revenue column) isn't one of the first few columns as authored,
 * buildDataSummary would still rank it to the front and put it in front of
 * the model; the model would then correctly cite a real breakdown figure for
 * it; and the evidence checker, which never computed a breakdown fact for
 * that column at all, would brand the real figure "unverified" or silently
 * rewrite it out of the report during the correction retry. Confirmed
 * against a real medical-insurance dataset: annual_medical_cost_usd is the
 * LAST of 9 numeric columns but the #2-ranked metric, and every region/
 * gender/smoker breakdown of it was flagged this way -- independently
 * recomputed from the raw data and confirmed correct to the cent in every
 * case. Sharing this one ranking closes the gap structurally instead of
 * relying on two hand-written lists staying in sync.
 *
 * aggType is computed value-aware (smartAgg(col, values), matching the
 * per-call pattern buildDataSummary already used) rather than name-only, so
 * a column that reads as an amount by name but holds proportions in [0, 1]
 * still gets the value-shape veto.
 */
export function rankedBusinessMetrics(
  dataset: Dataset
): { primaryMetric: string | null; profitCols: string[]; ranked: string[] } {
  const businessMetrics = businessMetricColumns(dataset);
  const aggTypes = new Map<string, "mean" | "sum">();
  for (const col of businessMetrics) {
    const values = dataset.rows.map((r) => r[col]).filter((v): v is number => typeof v === "number");
    aggTypes.set(col, smartAgg(col, values));
  }
  const aggTypeOf = (col: string): "mean" | "sum" => aggTypes.get(col) ?? "mean";

  const profitCols = businessMetrics.filter(
    (col) => tokenize(col).some((t) => AMOUNT_TOKENS.has(t)) && aggTypeOf(col) === "sum"
  );
  // BUG FIX (2026-10): the `?? businessMetrics[0]` tail was the same fault as
  // the `?? numericCols[0]` one removed from buildDataSummary -- it just took
  // one more step to reach. On a German export (Bestellnummer, Menge, Umsatz)
  // the order number was ranked first and became the primary metric, because
  // the old name-based identifier filter only knew English words. The role
  // resolver now classifies Bestellnummer as an identifier from its VALUES,
  // so it never reaches this list at all, which is the real fix; the tail is
  // kept because a file genuinely can have one legitimate non-sum metric.
  const primaryMetric =
    profitCols[0] ??
    businessMetrics.find((c) => aggTypeOf(c) === "sum") ??
    businessMetrics[0] ??
    null;
  const ranked = [
    ...profitCols,
    ...businessMetrics.filter((c) => !profitCols.includes(c) && aggTypeOf(c) === "sum"),
    ...businessMetrics.filter((c) => !profitCols.includes(c) && aggTypeOf(c) !== "sum"),
  ];
  return { primaryMetric, profitCols, ranked };
}

export interface DataSummaryOptions {
  filterCol?: string;
  filterVal?: string;
}

/** Mirrors build_data_summary: produces the text block sent to the AI report generator. */
export function buildDataSummary(dataset: Dataset, opts: DataSummaryOptions = {}): string {
  const { columns } = dataset;
  let { rows } = dataset;
  const { filterCol, filterVal } = opts;

  if (filterCol && filterVal && columns.includes(filterCol)) {
    rows = rows.filter((r) => String(r[filterCol]) === filterVal);
  }

  const filtered: Dataset = { rows, columns };
  const numericCols = numericColumns(filtered);
  const catCols = categoricalColumns(filtered);

  const lines: string[] = [];
  lines.push(`Rows: ${rows.length} | Columns: ${columns.length}`);
  if (filterCol && filterVal) lines.push(`Filtered to: ${filterCol} = ${filterVal}`);
  lines.push(`Numeric columns: [${numericCols.join(", ")}]`);
  // Label columns are the subset of non-numeric columns that can legitimately
  // key a breakdown (see groupingColumns): not dates, not half-numeric. The
  // rest are listed separately so the model is never left to assume a date or
  // a malformed amount column is a category it can group by.
  const labelCols = groupingColumns(filtered).filter((col) => hasUsableGroupSize(filtered, col));
  const otherCatCols = catCols.filter((col) => !labelCols.includes(col));
  lines.push(`Label columns (safe to group by): [${labelCols.join(", ")}]`);
  if (otherCatCols.length > 0) {
    lines.push(
      `Other non-numeric columns (dates, free text, near-unique values, or columns mixing text and numbers - do not group by these): [${otherCatCols.join(", ")}]`
    );
  }
  lines.push("");

  // Each numeric column is walked once, and both its stats and its aggregation
  // type are derived from that single walk. Every later decision in this
  // function reads from these maps, so a column can never be described one way
  // in NUMERIC SUMMARY and aggregated another way in a breakdown.
  const columnStats = new Map<string, NumericStats>();
  const aggTypes = new Map<string, "mean" | "sum">();
  for (const col of numericCols) {
    const values = rows
      .map((r) => r[col])
      .filter((v): v is number => typeof v === "number");
    columnStats.set(col, numericStats(values));
    aggTypes.set(col, smartAgg(col, values));
  }
  const aggTypeOf = (col: string) => aggTypes.get(col) ?? smartAgg(col);

  // Dollar-amount columns and the metric ranking -- see rankedBusinessMetrics()
  // above, which both this function and buildEvidenceFacts() (lib/evidence.ts)
  // now share, so the model is never shown a breakdown for a metric the
  // evidence checker didn't also rank in front and build facts for.
  const { primaryMetric: rankedPrimary, ranked: rankedMetrics } = rankedBusinessMetrics(filtered);
  const businessMetrics = businessMetricColumns(filtered);
  const businessMetricSet = new Set(businessMetrics);
  // BUG FIX (2026-10): this used to fall back to `?? numericCols[0]`. When no
  // column qualified as a business metric, numericCols[0] was whatever came
  // first in the file -- typically an id -- and every breakdown below then
  // totalled it. On a 100-row export with an Order ID, the model was handed
  // "TOP/BOTTOM BY SIGNED ON (TOTAL Order ID)" as the headline figure. There
  // is no safe fallback for a metric that does not exist, so there is none:
  // the metric-based blocks are skipped and row counts are sent instead.
  const primaryMetric = rankedPrimary;

  if (numericCols.length > 0) {
    lines.push("NUMERIC SUMMARY");
    for (const col of numericCols) {
      const st = columnStats.get(col)!;
      if (st.count === 0) continue;
      // Show an absolute total only where adding the column up means
      // something. BUG FIX (2026-09): a column matching NON_METRIC_PATTERNS
      // (an ID, a distinct-count, a rank/index) is never summed here even
      // when smartAgg's name-based guess called it "sum" (e.g. "Distinct
      // count of Customer ID" matches the "count" SUM_KEYWORD) -- these
      // columns hold a pre-aggregated per-row count or identifier, and
      // summing them across rows produces a number with no real-world
      // meaning. Labeled explicitly so the model is told this is a per-row
      // value, not left to guess and then cite the (non-existent) total as
      // if it were a dollar figure.
      const isBusinessMetric = businessMetricSet.has(col);
      const total = isBusinessMetric && aggTypeOf(col) === "sum" ? st.total : null;
      const note = isBusinessMetric ? "" : " [identifier/count column - per-row value only, never sum or total this]";
      lines.push(
        `  ${col}: count=${st.count} mean=${st.mean.toFixed(2)} std=${st.std.toFixed(2)} ` +
        `min=${st.min.toFixed(2)} max=${st.max.toFixed(2)}` +
        (total !== null ? ` TOTAL=${total.toFixed(2)}` : "") + note
      );
    }
    lines.push("");
  }

  // Prioritise amount columns in breakdowns so the model always sees dollar totals
  const breakdownMetrics = rankedMetrics.slice(0, 4);

  // Group keys come from labelCols, so a date or a half-numeric column can
  // never key a breakdown, and every group holds at least two rows on average
  // (hasUsableGroupSize). The old version scanned every non-numeric column
  // and only filtered on cardinality, which is how "TOP/BOTTOM BY AWARD
  // AMOUNT USD" reached the model on a 39-row file with 39 distinct amounts.
  const lowCardCats = labelCols.filter((col) => {
    const u = new Set(rows.map((r) => r[col])).size;
    return u >= 2 && u <= 20;
  });
  const highCardCats = labelCols.filter((col) => {
    const u = new Set(rows.map((r) => r[col])).size;
    return u > 20 && u <= 200; // e.g. State/Province -- too many for a full table but useful top/bottom
  });

  // ── No measurable metric: say so, and send row counts instead ────────────
  // The model cannot be left to fill this gap. Given a summary with no
  // figures in it, it writes plausible ones. So the absence is stated
  // explicitly, with the reason per column, and the only quantities supplied
  // are row counts, which are always true.
  if (!primaryMetric) {
    const unmeasured = describeUnmeasuredColumns(filtered);
    if (unmeasured.length > 0) {
      lines.push("NO MEASURABLE METRIC");
      lines.push(
        `  No column in this file qualifies as an amount that can be totalled or averaged. ` +
          `A column must be at least ${Math.round(MIN_METRIC_COVERAGE * 100)}% numbers, and must be a quantity ` +
          `rather than a date, a calendar year, a coordinate or an identifier.`
      );
      for (const u of unmeasured.slice(0, 8)) {
        lines.push(`  ${u.column}: ${u.detail}`);
      }
      lines.push(
        `  Do not report any total, average, growth rate or currency figure for these columns. ` +
          `Describe counts, categories and the data gaps themselves.`
      );
      lines.push("");
    }
    for (const cat of lowCardCats.slice(0, 4)) {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const key = String(row[cat] ?? "(blank)");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
      lines.push(`ROW COUNT BY ${cat.toUpperCase()}`);
      lines.push(`  ` + ordered.map(([k, n]) => `${k}=${n}`).join(", "));
      lines.push("");
    }
  }

  // Standard breakdowns for low-cardinality categories
  let breakdownCount = 0;
  for (const cat of lowCardCats) {
    if (breakdownCount >= 4) break;
    const breakdownLines: string[] = [];
    for (const nc of breakdownMetrics) {
      const { agg: how, points } = aggregateBy(filtered, cat, nc);
      // The model is told which operation produced these, so it cannot
      // describe an average as a total in the report text.
      breakdownLines.push(
        `  ${how === "sum" ? "TOTAL" : "AVERAGE"} ${nc} by ${cat}: ` +
          points.map((a) => `${a.key}=${a.value.toFixed(2)}`).join(", ")
      );
    }
    if (breakdownLines.length > 0) {
      lines.push(`BREAKDOWN BY ${cat.toUpperCase()}`);
      lines.push(...breakdownLines);
      lines.push("");
      breakdownCount++;
    }
  }

  // Top/bottom breakdown for high-cardinality columns (e.g. State) — surfaces loss-makers
  if (primaryMetric) {
    for (const cat of highCardCats.slice(0, 2)) {
      const { agg: how, points } = aggregateBy(filtered, cat, primaryMetric);
      if (points.length < 3) continue;
      const top5    = points.slice(0, 5);
      const bottom5 = points.slice(-5).reverse();
      lines.push(
        `TOP/BOTTOM BY ${cat.toUpperCase()} (${how === "sum" ? "TOTAL" : "AVERAGE"} ${primaryMetric})`
      );
      lines.push(`  Top 5:    ` + top5.map(a => `${a.key}=${a.value.toFixed(2)}`).join(", "));
      lines.push(`  Bottom 5: ` + bottom5.map(a => `${a.key}=${a.value.toFixed(2)}`).join(", "));
      lines.push("");
    }
  }

  // Cross-breakdown: first two low-cardinality cats (e.g. Region × Category)
  if (lowCardCats.length >= 2 && primaryMetric) {
    const cat1 = lowCardCats[0];
    const cat2 = lowCardCats[1];
    const groups = new Map<string, number[]>();
    for (const row of rows) {
      const key = `${row[cat1]} × ${row[cat2]}`;
      const v = row[primaryMetric];
      if (typeof v !== "number") continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(v);
    }
    const aggType = aggTypeOf(primaryMetric);
    const crossAgg = Array.from(groups.entries())
      .map(([key, vals]) => ({
        key,
        value: aggType === "sum" ? vals.reduce((a, b) => a + b, 0) : mean(vals),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
    if (crossAgg.length > 0) {
      lines.push(`CROSS-BREAKDOWN ${cat1.toUpperCase()} × ${cat2.toUpperCase()} (${primaryMetric})`);
      lines.push("  " + crossAgg.map(a => `${a.key}=${a.value.toFixed(2)}`).join(", "));
      lines.push("");
    }
  }

  // Derived figures are spliced in here at the end, once the final length of
  // everything else is known (see the budget check before the quality score).
  const derivedInsertAt = lines.length;

  // Only run anomaly detection on genuine business metrics, not ID/count
  // columns -- and not columns that are numeric but still count-like by
  // SHAPE (see looksLikeBoundedCount), which z-score treats as "anomalous"
  // purely because their range is small and skewed, not because any row is
  // actually unusual.
  const metricCols = businessMetricColumns(filtered).filter(
    (col) => !looksLikeBoundedCount(filtered, col)
  );
  const anomalyLines: string[] = [];
  for (const col of metricCols.slice(0, 5)) {
    const anomalies = detectAnomalies(filtered, col);
    if (anomalies.length > 0) {
      anomalyLines.push(`  ${col}: ${anomalies.length} anomalous rows (z > 2)`);
    }
  }
  if (anomalyLines.length > 0) {
    lines.push("ANOMALIES DETECTED");
    lines.push(...anomalyLines);
    lines.push("");
  }

  if (numericCols.length >= 2) {
    const pairs: { a: string; b: string; r: number; n: number }[] = [];
    for (let i = 0; i < numericCols.length; i++) {
      for (let j = i + 1; j < numericCols.length; j++) {
        const a = numericCols[i];
        const b = numericCols[j];
        const result = pairwiseCorrelation(rows, a, b);
        if (result) pairs.push({ a, b, r: result.r, n: result.n });
      }
    }
    if (pairs.length > 0) {
      pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
      lines.push("TOP CORRELATIONS");
      for (const p of pairs.slice(0, 5)) {
        // n is printed so a coefficient over a handful of overlapping rows is
        // visibly different from one over the whole dataset.
        lines.push(`  ${p.a} ~ ${p.b}: ${p.r.toFixed(3)} (n=${p.n})`);
      }
      lines.push("");
    }
  }

  // DERIVED FIGURES: figures Nixara computes itself, handed to the model to
  // copy rather than recompute. Budget-guarded: the server rejects summaries
  // over 8,000 characters (413), so this only adds as many lines as fit under
  // DERIVED_SUMMARY_BUDGET and never makes a wide dataset fail to generate.
  const derived = computeDerivedFigures(filtered);
  if (derived.length > 0) {
    const block: string[] = [
      "DERIVED FIGURES (calculated by Nixara from the data above - copy exactly as written, never recompute or round)",
    ];
    for (const r of derived.filter((d) => d.kind === "ratio").slice(0, 3)) {
      block.push(`  ${r.label}: ${r.value.toFixed(2)}% (${r.formula})`);
    }
    const sets = new Map<string, DerivedFigure[]>();
    for (const d of derived) {
      if (d.kind !== "share" || !d.set) continue;
      if (!sets.has(d.set)) sets.set(d.set, []);
      sets.get(d.set)!.push(d);
    }
    for (const [set, items] of sets) {
      const top = [...items].sort((a, b) => b.value - a.value).slice(0, 6);
      block.push(`  ${set}: ` + top.map((d) => `${d.item}=${d.value.toFixed(2)}%`).join(", "));
    }
    if (block.length > 1) {
      const current = lines.join("\n").length;
      const kept: string[] = [block[0]];
      let used = current + block[0].length + 2;
      for (const line of block.slice(1)) {
        if (used + line.length + 1 > DERIVED_SUMMARY_BUDGET) break;
        kept.push(line);
        used += line.length + 1;
      }
      if (kept.length > 1) lines.splice(derivedInsertAt, 0, ...kept, "");
    }
  }

  lines.push(`Data Quality Score: ${dashboardScore(filtered)}/100`);
  return lines.join("\n");
}
