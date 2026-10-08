/**
 * Finds and removes summary rows that an export put in with the data.
 *
 * Almost every spreadsheet a business actually sends has a "Grand Total" row
 * at the bottom, and many have subtotals interleaved. Nothing in the engine
 * knew that, so the total row was read as an ordinary observation. Measured
 * on 20 rows of 100 per region plus one Grand Total row of 2000:
 *
 *   Sales: count=21 mean=190.48 TOTAL=4000.00        the file holds 2000
 *   TOTAL Sales by Region: Grand Total=2000.00, East=500.00, ...
 *   Share of total Sales by Region: Grand Total=50.00%, ...
 *   detectAnomalies flags exactly one row: the total
 *
 * Every total doubles, the summary row becomes the largest category, it is
 * flagged as the file's one anomaly, and the share lands in DERIVED FIGURES,
 * which the prompt tells the model to copy exactly as written. So the model is
 * instructed to report that "Grand Total accounts for 50% of sales".
 *
 * Two kinds of evidence, either sufficient:
 *
 *   label        a label cell reads "Total", "Grand Total", "Subtotal",
 *                "Summe", "Gesamt", "Totaal" and so on. Cheap and usually
 *                right, but it is a word list, so it only ever ADDS.
 *   arithmetic   the row's value equals the sum of the other rows' values in
 *                the same column. Language-independent, and the real test:
 *                it catches a total row labelled in any language, or not
 *                labelled at all.
 *
 * Removal is never silent. The caller puts a line in dataset.warnings, which
 * the upload screen shows above the dashboard, naming the rows taken out.
 * Dropping rows the user can see in their own file without saying so would be
 * its own kind of unexplained behaviour.
 */

import { columnsWithRole } from "./column-roles";

export interface AggregateRowFinding {
  /** Index into dataset.rows. */
  index: number;
  /** The row's label cell, for the warning text. */
  label: string;
  reason: "label" | "arithmetic";
  /** What was observed, in plain English. */
  evidence: string;
}

interface MinimalDataset {
  rows: Record<string, unknown>[];
  columns: string[];
}

/**
 * Words that mark a summary row. Matched against the WHOLE trimmed cell, never
 * as a substring: a customer named "Total Fitness Ltd" is a customer.
 */
const TOTAL_LABELS = new Set([
  "total", "totals", "grand total", "grandtotal", "sub total", "subtotal",
  "sum", "summary", "overall", "all", "average", "mean",
  // The same word in the languages most likely to appear in a European export.
  "summe", "gesamt", "gesamtsumme", "insgesamt", "zwischensumme",
  "totaal", "totale", "totali", "suma", "subtotales", "total general",
  "totalt", "yhteensä", "razem", "celkem", "итого",
]);

function labelLooksLikeTotal(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase().replace(/[:\-–—]+$/, "").trim();
  if (normalized === "") return false;
  return TOTAL_LABELS.has(normalized);
}

/**
 * Minimum other rows before the arithmetic test is trusted. With only a
 * handful of rows, one of them equalling the sum of the rest is a coincidence
 * waiting to happen -- two rows of 5 and 10 plus a row of 15 is a real
 * possibility in genuine data.
 */
const MIN_PEERS_FOR_ARITHMETIC = 5;

/** Relative tolerance, so a rounded total still matches. */
const SUM_TOLERANCE = 0.005;

export function detectAggregateRows(dataset: MinimalDataset): AggregateRowFinding[] {
  const { rows } = dataset;
  if (rows.length < 3) return [];

  const labelCols = columnsWithRole(dataset, "label");
  const metricCols = columnsWithRole(dataset, "metric");
  const found = new Map<number, AggregateRowFinding>();

  // ── Evidence 1: the row says what it is ──────────────────────────────────
  for (let i = 0; i < rows.length; i++) {
    for (const col of labelCols) {
      if (labelLooksLikeTotal(rows[i][col])) {
        found.set(i, {
          index: i,
          label: String(rows[i][col]).trim(),
          reason: "label",
          evidence: `${col} reads "${String(rows[i][col]).trim()}"`,
        });
        break;
      }
    }
  }

  // ── Evidence 2: the row is the sum of the others ─────────────────────────
  // Done per metric column. A row only has to prove it once, but the column
  // must have enough other rows for the match to mean anything.
  for (const col of metricCols) {
    const values: (number | null)[] = rows.map((r) =>
      typeof r[col] === "number" ? (r[col] as number) : null
    );
    const present = values.filter((v): v is number => v !== null);
    if (present.length < MIN_PEERS_FOR_ARITHMETIC + 1) continue;
    const total = present.reduce((a, b) => a + b, 0);

    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null || found.has(i)) continue;
      const peers = total - v;
      // A zero column, or a row of zero, proves nothing.
      if (peers === 0 || v === 0) continue;
      if (Math.abs(v - peers) / Math.abs(peers) > SUM_TOLERANCE) continue;

      const label = labelCols
        .map((c) => rows[i][c])
        .find((x) => typeof x === "string" && x.trim() !== "");
      found.set(i, {
        index: i,
        label: typeof label === "string" ? label.trim() : `row ${i + 1}`,
        reason: "arithmetic",
        evidence: `its ${col} equals the sum of the other ${present.length - 1} rows`,
      });
    }
  }

  // Never remove the whole file. If more than a third of the rows look like
  // totals, this is a pre-aggregated report rather than a table with a total
  // row, and removing them would delete the data instead of cleaning it.
  const findings = [...found.values()].sort((a, b) => a.index - b.index);
  if (findings.length > rows.length / 3) return [];
  return findings;
}

/** One sentence for dataset.warnings, so the removal is visible. */
export function describeAggregateRows(findings: AggregateRowFinding[]): string {
  if (findings.length === 1) {
    const f = findings[0];
    return `Left out 1 summary row ("${f.label}") because ${f.evidence}. Counting it would have doubled every total.`;
  }
  const names = findings.slice(0, 3).map((f) => `"${f.label}"`).join(", ");
  const more = findings.length > 3 ? `, and ${findings.length - 3} more` : "";
  return `Left out ${findings.length} summary rows (${names}${more}) because their values repeat totals already present in the other rows. Counting them would have inflated every figure.`;
}

/**
 * The dataset with its summary rows removed, plus what was removed.
 *
 * Returns the SAME object when there is nothing to remove, so the role-resolver
 * cache (keyed on the dataset object) is not needlessly invalidated.
 */
export function stripAggregateRows<T extends MinimalDataset & { warnings?: string[] }>(
  dataset: T
): { dataset: T; removed: AggregateRowFinding[] } {
  const removed = detectAggregateRows(dataset);
  if (removed.length === 0) return { dataset, removed };

  const drop = new Set(removed.map((f) => f.index));
  return {
    dataset: {
      ...dataset,
      rows: dataset.rows.filter((_, i) => !drop.has(i)),
      warnings: [...(dataset.warnings ?? []), describeAggregateRows(removed)],
    },
    removed,
  };
}
