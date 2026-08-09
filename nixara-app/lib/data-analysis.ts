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
}

const NUMERIC_THRESHOLD = 0.5;

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

  return { rows: cleanedRows, columns };
}

export function numericColumns(dataset: Dataset): string[] {
  return dataset.columns.filter((col) =>
    dataset.rows.some((r) => typeof r[col] === "number")
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

export function businessMetricColumns(dataset: Dataset): string[] {
  return numericColumns(dataset).filter(
    (col) => !NON_METRIC_PATTERNS.some((pattern) => pattern.test(col))
  );
}

export function categoricalColumns(dataset: Dataset): string[] {
  const numeric = new Set(numericColumns(dataset));
  return dataset.columns.filter((col) => !numeric.has(col));
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
function tokenize(text: string): string[] {
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

/** Mirrors detect_anomalies: rows where |z-score| > 2 for the given numeric column. */
export function detectAnomalies(dataset: Dataset, col: string): Row[] {
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

/** Mirrors dashboard_score: starts at 100, deducts for missing data / shape issues. */
export function dashboardScore(dataset: Dataset): number {
  const { rows, columns } = dataset;
  let score = 100;

  if (rows.length > 0 && columns.length > 0) {
    let missing = 0;
    for (const row of rows) {
      for (const col of columns) {
        const v = row[col];
        if (v === null || v === undefined || v === "") missing++;
      }
    }
    const missingRatio = missing / (rows.length * columns.length);
    if (missingRatio > 0.2) score -= 20;
  }
  if (columns.length > 20) score -= 10;
  if (rows.length < 10) score -= 10;

  return Math.max(score, 0);
}

const SUM_KEYWORDS = [
  "sales", "revenue", "profit", "income", "earnings", "cost", "costs", "price",
  "amount", "total", "spend", "spending", "expense", "expenses", "budget",
  "quantity", "qty", "units", "volume", "billing", "charge", "charges", "fee",
  "fees", "payment", "payments", "count", "visits", "orders", "transactions",
];
const MEAN_KEYWORDS = [
  "average", "avg", "mean", "rate", "ratio", "margin", "score", "pct", "percent",
  "age", "duration", "tenure", "bmi", "height", "weight", "index", "level",
  "days", "years", "months", "rating", "satisfaction", "length", "distance",
  "temperature", "speed", "density", "concentration",
];

/**
 * BUG FIX (2026-08): this used to default to "sum" for any column that didn't
 * match a short "mean-like" keyword list — which meant a column like "Age"
 * (not on the list) got summed across every row in a group, producing
 * meaningless totals like 1,430,368 instead of an average. A hardcoded
 * keyword list will never cover every possible per-entity attribute name
 * across every industry Nixara sees data from (age, BMI, tenure, GPA,
 * rating, days-since...), so instead of trying to enumerate all of them,
 * the fallback for an *unrecognized* column name is now "mean" — the safer
 * assumption for an arbitrary numeric column — and only the smaller, more
 * stable vocabulary of clearly-additive business terms (sales, cost,
 * quantity, count...) triggers "sum".
 */
export function smartAgg(colName: string): "mean" | "sum" {
  const lower = colName.toLowerCase();
  if (MEAN_KEYWORDS.some((k) => lower.includes(k))) return "mean";
  if (SUM_KEYWORDS.some((k) => lower.includes(k))) return "sum";
  return "mean";
}

export function aggregateBy(
  dataset: Dataset,
  groupCol: string,
  valueCol: string
): { key: string; value: number }[] {
  const agg = smartAgg(valueCol);
  const groups = new Map<string, number[]>();

  for (const row of dataset.rows) {
    const raw = row[groupCol];
    const key = raw instanceof Date ? formatDateSafe(raw) : String(raw ?? "—");
    const v = row[valueCol];
    if (typeof v !== "number") continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
  }

  return Array.from(groups.entries())
    .map(([key, values]) => ({
      key,
      value: agg === "mean" ? mean(values) : values.reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.value - a.value);
}

export interface ChartSpec {
  type: "bar" | "pie" | "area" | "treemap";
  title: string;
  data: { key: string; value: number }[];
}

/**
 * Aggregates a metric by month for any Date-typed column, regardless of how
 * granular the source timestamps are (a per-second admission timestamp
 * column can have tens of thousands of distinct raw values — far too many
 * to chart directly, but perfectly readable once bucketed to month).
 */
export function bucketByMonth(dataset: Dataset, dateCol: string, valueCol: string): { key: string; value: number }[] {
  const agg = smartAgg(valueCol);
  const groups = new Map<string, number[]>();
  const sortKeys = new Map<string, number>();

  for (const row of dataset.rows) {
    const d = row[dateCol];
    const v = row[valueCol];
    if (!(d instanceof Date) || typeof v !== "number") continue;
    const key = monthBucketKey(d);
    if (!groups.has(key)) {
      groups.set(key, []);
      sortKeys.set(key, monthBucketSortKey(d));
    }
    groups.get(key)!.push(v);
  }

  return Array.from(groups.entries())
    .map(([key, values]) => ({
      key,
      value: agg === "mean" ? mean(values) : values.reduce((a, b) => a + b, 0),
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
export function pickChartSpecs(dataset: Dataset, decisionText: string, maxCharts = 2): ChartSpec[] {
  const { category, metrics } = selectChartColumns(dataset, decisionText);
  const specs: ChartSpec[] = [];
  const primaryMetric = metrics[0];

  const dateCol = findDateColumn(dataset);
  if (dateCol && primaryMetric) {
    const data = bucketByMonth(dataset, dateCol, primaryMetric);
    if (data.length >= 2) {
      specs.push({ type: "area", title: `${primaryMetric} over time (by ${dateCol})`, data });
    }
  }

  if (category && primaryMetric && specs.length < maxCharts) {
    const metric = specs.length > 0 && metrics[1] ? metrics[1] : primaryMetric;
    const data = aggregateBy(dataset, category, metric);
    const cardinality = data.length;
    const hasNegative = data.some((d) => d.value < 0);

    let type: ChartSpec["type"] = "bar";
    if (cardinality >= 2 && cardinality <= 6 && !hasNegative) type = "pie";
    else if (cardinality > 12 && !hasNegative) type = "treemap";

    specs.push({ type, title: `${metric} by ${category}`, data });
  }

  return specs.slice(0, maxCharts);
}

export interface DataSummaryOptions {
  filterCol?: string;
  filterVal?: string;
}

/** Mirrors build_data_summary: produces the text block sent to the AI report generator. */
export function buildDataSummary(dataset: Dataset, opts: DataSummaryOptions = {}): string {
  let { rows, columns } = dataset;
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

  // Identify profit/revenue/sales columns — these should always be summed, never averaged
  const profitKeywords = ["profit", "revenue", "sales", "income", "earnings", "margin"];
  const profitCols = numericCols.filter(col =>
    profitKeywords.some(k => col.toLowerCase().includes(k))
  );
  // Primary dollar metric: first profit-like col, or first sum-type numeric col
  const primaryMetric =
    profitCols[0] ??
    numericCols.find(c => smartAgg(c) === "sum") ??
    numericCols[0];

  if (numericCols.length > 0) {
    lines.push("NUMERIC SUMMARY");
    for (const col of numericCols) {
      const values = rows.map((r) => r[col]).filter((v): v is number => typeof v === "number");
      if (values.length === 0) continue;
      const m = mean(values);
      const s = std(values, m);
      const min = Math.min(...values);
      const max = Math.max(...values);
      // Show absolute total for sum-type columns (profit, sales, revenue, etc.)
      const aggType = smartAgg(col);
      const total = aggType === "sum" ? values.reduce((a, b) => a + b, 0) : null;
      lines.push(
        `  ${col}: count=${values.length} mean=${m.toFixed(2)} std=${s.toFixed(2)} ` +
        `min=${min.toFixed(2)} max=${max.toFixed(2)}` +
        (total !== null ? ` TOTAL=${total.toFixed(2)}` : "")
      );
    }
    lines.push("");
  }

  // Prioritise profit/sales cols in breakdowns so AI always sees dollar totals
  const breakdownMetrics = [
    ...profitCols,
    ...numericCols.filter(c => !profitCols.includes(c) && smartAgg(c) === "sum"),
    ...numericCols.filter(c => !profitCols.includes(c) && smartAgg(c) !== "sum"),
  ].slice(0, 4);

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
      const agg = aggregateBy(filtered, cat, nc);
      breakdownLines.push(
        `  ${nc} by ${cat}: ` + agg.map((a) => `${a.key}=${a.value.toFixed(2)}`).join(", ")
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
      const agg = aggregateBy(filtered, cat, primaryMetric);
      if (agg.length < 3) continue;
      const top5    = agg.slice(0, 5);
      const bottom5 = agg.slice(-5).reverse();
      lines.push(`TOP/BOTTOM BY ${cat.toUpperCase()} (${primaryMetric})`);
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
    const aggType = smartAgg(primaryMetric);
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

  // Only run anomaly detection on genuine business metrics, not ID/count columns
  const metricCols = businessMetricColumns(filtered);
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
    lines.push("TOP CORRELATIONS");
    const pairs: { a: string; b: string; corr: number }[] = [];
    for (let i = 0; i < numericCols.length; i++) {
      for (let j = i + 1; j < numericCols.length; j++) {
        const a = numericCols[i];
        const b = numericCols[j];
        const av = rows.map((r) => r[a]).filter((v): v is number => typeof v === "number");
        const bv = rows.map((r) => r[b]).filter((v): v is number => typeof v === "number");
        const n = Math.min(av.length, bv.length);
        if (n < 2) continue;
        const ma = mean(av.slice(0, n));
        const mb = mean(bv.slice(0, n));
        let num = 0, da = 0, db = 0;
        for (let k = 0; k < n; k++) {
          num += (av[k] - ma) * (bv[k] - mb);
          da += (av[k] - ma) ** 2;
          db += (bv[k] - mb) ** 2;
        }
        const denom = Math.sqrt(da * db);
        if (denom === 0) continue;
        pairs.push({ a, b, corr: num / denom });
      }
    }
    pairs.sort((x, y) => Math.abs(y.corr) - Math.abs(x.corr));
    for (const p of pairs.slice(0, 5)) {
      lines.push(`  ${p.a} ~ ${p.b}: ${p.corr.toFixed(3)}`);
    }
    lines.push("");
  }

  lines.push(`Data Quality Score: ${dashboardScore(filtered)}/100`);
  return lines.join("\n");
}
