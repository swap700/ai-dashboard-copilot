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
 * This is necessarily best-effort, not a guarantee. A match requires the
 * cited figure to equal (within rounding) something Nixara actually computed
 * — true for the large majority of cited figures, since the prompts instruct
 * the model to cite the provided numbers rather than invent new ones, but not
 * airtight against paraphrased or derived figures. Where no match is found,
 * the caller renders the number as an ordinary, unlinked figure — never an
 * error and never a false claim of traceability.
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

/**
 * Parses ONE cited figure out of `text` using the same pattern already used
 * throughout report-visual.ts / ReportVisual.tsx ($X,XXX.XX or NN.N%), then
 * looks for a fact whose value matches within rounding tolerance. Callers
 * pass a specific extracted field (a Signal, a Consequence, a Quick Win's
 * stat) rather than a whole paragraph, so taking the first match is
 * unambiguous in practice.
 */
export function findEvidence(text: string, facts: EvidenceFact[]): EvidenceFact | null {
  const dollarM = /\$([\d,]+\.\d{2})/.exec(text);
  if (dollarM) {
    const target = Number(dollarM[1].replace(/,/g, ""));
    return facts.find((f) => !f.isPercent && closeEnough(f.value, target)) ?? null;
  }
  const pctM = /(\d+(?:\.\d+)?)%/.exec(text);
  if (pctM) {
    const target = Number(pctM[1]);
    return facts.find((f) => f.isPercent && closeEnough(f.value, target)) ?? null;
  }
  return null;
}
