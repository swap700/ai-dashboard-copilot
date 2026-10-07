/**
 * Client-side port of the data-analysis helpers from dashboard_ai_app.py
 * (clean_dataframe, detect_anomalies, dashboard_score, smart_agg, build_data_summary).
 * Operates on a simple row-array representation instead of pandas DataFrames.
 */

import { formatDateSafe, isDateColumn, monthBucketKey, monthBucketSortKey } from "./format";

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
}

const NUMERIC_THRESHOLD = 0.5;

/** Leaves headroom under the server's 8,000-char summary cap (route.ts MAX_SUMMARY_CHARS). */
const DERIVED_SUMMARY_BUDGET = 7500;

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[$,]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Mirrors clean_dataframe: coerces string columns to numeric when >50% of values parse. */
export function cleanDataset(dataset: Dataset): Dataset {
  const { rows, columns } = dataset;
  const numericCols = new Set<string>();

  for (const col of columns) {
    let parsed = 0;
    for (const row of rows) {
      if (toNumberOrNull(row[col]) !== null) parsed++;
    }
    if (rows.length > 0 && parsed / rows.length > NUMERIC_THRESHOLD) {
      numericCols.add(col);
    }
  }

  const cleanedRows = rows.map((row) => {
    const next: Row = { ...row };
    for (const col of numericCols) {
      next[col] = toNumberOrNull(row[col]);
    }
    return next;
  });

  // Spread first so optional fields such as `warnings` survive cleaning.
  return { ...dataset, rows: cleanedRows, columns };
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
 * A column has to clear MIN_METRIC_COVERAGE before Nixara will chart it,
 * average it or hand it to the model as a metric.
 *
 * Why a second, stricter bar than NUMERIC_THRESHOLD: a column can be numeric
 * enough to be worth typing as a number and still be too sparse to average
 * honestly. 0.8 says four out of five rows must carry a real value. Below
 * that, any single figure quietly describes a minority of the data.
 */
export const MIN_METRIC_COVERAGE = 0.8;

/**
 * BUG FIX (2026-10): this used `.some()` - one numeric cell anywhere made the
 * whole column "numeric". cleanDataset() meanwhile refuses to coerce a column
 * unless more than NUMERIC_THRESHOLD of it parses, so the two functions
 * answered the same question differently and the weaker one won downstream.
 *
 * Found on coaster_db.csv: across 1087 rows 'Opening date' holds 659 text
 * values ("December 1912", "3 July 1920"), 178 numbers (bare years Papa typed
 * because dynamicTyping types cells individually rather than columns), and
 * 250 blanks. 16.4% numeric. cleanDataset correctly declined it at 16% numeric.
 * numericColumns then promoted it anyway, and the app charted "Opening Date by
 * Status", averaging 104 of 668 Operating rows into a tooltip reading 1,979.85
 * with nothing on screen saying it came from a sixth of the data.
 *
 * Both functions now use the same threshold, so a column the cleaner rejected
 * can no longer be treated as a number by anything further down.
 */
export function numericColumns(dataset: Dataset): string[] {
  return dataset.columns.filter(
    (col) => numericDensity(dataset, col) > NUMERIC_THRESHOLD
  );
}

/**
 * Subset of numericColumns that are genuine business metrics worth analysing
 * for anomalies and charting. Excludes:
 *   - ID / key columns (Row ID, Customer ID, Order ID …)
 *   - Count / distinct-count aggregations (added by Tableau, Excel pivot tables …)
 *   - Rank / index helper columns
 * These would produce misleading anomaly signals if included.
 */
const NON_METRIC_PATTERNS = [
  /\bid\b/i,
  /\bcount\b/i,
  /\bdistinct\b/i,
  /\bkey\b/i,
  /\bindex\b/i,
  /\brank\b/i,
  /\bnumber\b/i,
  /\bno\b\.?$/i,    // "Order No.", "Row No."
];

/**
 * The columns Nixara is willing to treat as a business metric: numeric by
 * name and by density, not an ID or a count, and an amount rather than a
 * coordinate.
 */
export function businessMetricColumns(dataset: Dataset): string[] {
  return numericColumns(dataset).filter(
    (col) =>
      !NON_METRIC_PATTERNS.some((pattern) => pattern.test(col)) &&
      numericDensity(dataset, col) >= MIN_METRIC_COVERAGE &&
      !isNonQuantityColumn(dataset, col)
  );
}

export function categoricalColumns(dataset: Dataset): string[] {
  const numeric = new Set(numericColumns(dataset));
  return dataset.columns.filter((col) => !numeric.has(col));
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
  const cats = categoricalColumns(dataset);
  const metricCols = businessMetricColumns(dataset);
  if (cats.length === 0 || metricCols.length === 0) return { category: null, metrics: [] };

  const questionTokens = new Set(tokenize(decisionText ?? ""));

  // Only a categorical column with a manageable number of distinct values makes a
  // readable bar chart — try candidates in relevance order, skipping high-cardinality ones
  // (e.g. "Customer Name") rather than bailing out entirely on the first miss.
  const catCandidates = [...cats].sort(
    (a, b) => relevanceScore(questionTokens, b) - relevanceScore(questionTokens, a)
  );
  const category =
    catCandidates.find((c) => new Set(dataset.rows.map((r) => r[c])).size <= 25) ?? null;

  const metricCandidates = [...metricCols].sort(
    (a, b) => relevanceScore(questionTokens, b) - relevanceScore(questionTokens, a)
  );
  const metrics = metricCandidates.slice(0, 2);

  return { category, metrics };
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
  // Mostly Date objects: a date column, whatever it is called.
  if (isDateColumn(dataset.rows, col)) return true;
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
  key: "missingData" | "columnCount" | "rowCount";
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
const NULL_PLACEHOLDER_TOKENS = new Set([
  "na", "n/a", "n.a.", "null", "none", "nan",
  "#n/a", "#null!", "#value!", "#div/0!", "missing",
]);
// Deliberately NOT included: a bare "-" or "--". Both are a common blank
// convention in some exports, but a value starting with "-" is also a
// formula-injection trigger character (see sanitizeCell in file-parser.ts),
// so by the time this runs it may already carry a guard prefix ("'--"),
// making detection inconsistent depending on parse order. Narrower but
// reliable beats broader but sometimes-silently-missed.

function isMissingValue(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (typeof v === "string") return NULL_PLACEHOLDER_TOKENS.has(v.trim().toLowerCase());
  return false;
}

export function dashboardScoreBreakdown(dataset: Dataset): DashboardScoreBreakdown {
  const { rows, columns } = dataset;
  let score = 100;
  const reasons: DashboardScoreReason[] = [];
  let missingRatio = 0;

  if (rows.length > 0 && columns.length > 0) {
    let missing = 0;
    for (const row of rows) {
      for (const col of columns) {
        if (isMissingValue(row[col])) missing++;
      }
    }
    missingRatio = missing / (rows.length * columns.length);
    if (missingRatio > 0.2) {
      score -= 20;
      reasons.push({
        key: "missingData",
        penalty: 20,
        message: `${(missingRatio * 100).toFixed(1)}% of cells are missing or blank`,
      });
    }
  }

  if (columns.length > 20) {
    score -= 10;
    reasons.push({
      key: "columnCount",
      penalty: 10,
      message: `${columns.length} columns is on the high side for clean analysis`,
    });
  }

  if (rows.length < 10) {
    score -= 10;
    reasons.push({
      key: "rowCount",
      penalty: 10,
      message: `Only ${rows.length} row${rows.length === 1 ? "" : "s"} -- too few for reliable patterns`,
    });
  }

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

  const idLikeColumns = columns.filter((col) => NON_METRIC_PATTERNS.some((p) => p.test(col)));
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

export interface ChartSpec {
  type: "bar" | "pie" | "area" | "treemap";
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
function findDateColumn(dataset: Dataset): string | null {
  for (const col of dataset.columns) {
    if (!isDateColumn(dataset.rows, col)) continue;
    const months = new Set(
      dataset.rows
        .filter((r): r is Row & { [k: string]: Date } => r[col] instanceof Date)
        .map((r) => monthBucketKey(r[col] as Date))
    );
    if (months.size >= 2) return col;
  }
  return null;
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
/** "Total" or "Average of", for the front of a chart title. */
export function aggWord(agg: "mean" | "sum"): string {
  return agg === "sum" ? "Total" : "Average of";
}

export function pickChartSpecs(dataset: Dataset, decisionText: string, maxCharts = 2): ChartSpec[] {
  const { category, metrics } = selectChartColumns(dataset, decisionText);
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
      });
    }
  }

  if (category && primaryMetric && specs.length < maxCharts) {
    const metric = specs.length > 0 && metrics[1] ? metrics[1] : primaryMetric;
    const { agg: how, points: data, used, total } = aggregateBy(dataset, category, metric);
    const cardinality = data.length;
    const hasNegative = data.some((d) => d.value < 0);

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
    });
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
  lines.push(`Categorical columns: [${catCols.join(", ")}]`);
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
  const primaryMetric = rankedPrimary ?? numericCols[0];

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

  // Find the most useful categorical columns: prefer low-cardinality (2–20 unique values)
  // Skip ID/date/name columns, scan ALL catCols (not just first 3)
  const lowCardCats = catCols.filter(col => {
    const u = new Set(rows.map(r => r[col])).size;
    return u >= 2 && u <= 20;
  });
  const highCardCats = catCols.filter(col => {
    const u = new Set(rows.map(r => r[col])).size;
    return u > 20 && u <= 200; // e.g. State/Province — too many for full table but useful top/bottom
  });

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
