import { businessMetricColumns, humanizeColumnName, matchKeywordsToColumns, type Dataset } from "./data-analysis";

/**
 * Decision Templates — a lookup table, not a modeling system. Each template
 * maps a common decision-type to a ready-to-edit decision question plus the
 * metric-name keywords that kind of decision usually turns on. Selecting one
 * pre-fills the Decision Context field in ReportSetup via resolveDecisionText
 * below, which also uses the keyword list to find and name the columns THIS
 * dataset actually has (see matchKeywordsToColumns in lib/data-analysis.ts) --
 * so the inserted question is dataset-aware instead of pure boilerplate. The
 * keyword list is also shown verbatim as the chip's hover tooltip.
 */

export interface DecisionTemplate {
  id: string;
  label: string;
  decisionText: string;
  /** Extra tokens merged into the relevance-scoring pass, on top of decisionText itself. */
  metricKeywords: string[];
}

export const DECISION_TEMPLATES: DecisionTemplate[] = [
  {
    id: "pricing",
    label: "Pricing / discounting",
    decisionText: "Should we adjust pricing or discount policy to protect margin?",
    metricKeywords: ["price", "discount", "margin", "revenue"],
  },
  {
    id: "cost",
    label: "Cost reduction",
    decisionText: "Where can we cut costs this quarter without hurting revenue?",
    metricKeywords: ["cost", "expense", "spend", "budget"],
  },
  {
    id: "expansion",
    label: "Expansion / hiring",
    decisionText: "Should we expand into a new region or add headcount?",
    metricKeywords: ["headcount", "revenue", "capacity", "hours"],
  },
  {
    id: "retention",
    label: "Customer retention",
    decisionText: "How do we reduce customer churn and protect retention?",
    metricKeywords: ["churn", "retention", "customer", "renewal"],
  },
  {
    id: "efficiency",
    label: "Operational efficiency",
    decisionText: "Where is effort or spend not matching the return it produces?",
    metricKeywords: ["efficiency", "utilization", "turnaround", "quantity"],
  },
  {
    id: "risk",
    label: "Risk / compliance",
    decisionText: "What risks need executive attention this quarter?",
    metricKeywords: ["risk", "compliance", "exposure", "incident"],
  },
];

/**
 * Resolves a template's decision text against the currently loaded dataset.
 * When the dataset has business-metric columns whose names overlap the
 * template's metricKeywords, the matched column names (humanized) are named
 * in the inserted text -- so clicking "Pricing / discounting" on a retail
 * export mentions "Profit Margin, Discount" while the same click on a
 * healthcare dataset would name whatever cost/price columns THAT data has,
 * instead of both getting identical generic boilerplate. Falls back to the
 * template's plain decisionText when there's no dataset yet, or when nothing
 * in it overlaps this template's keywords at all.
 */
export function resolveDecisionText(template: DecisionTemplate, dataset?: Dataset): string {
  if (!dataset) return template.decisionText;
  const metricCols = businessMetricColumns(dataset);
  if (metricCols.length === 0) return template.decisionText;
  const matches = matchKeywordsToColumns(metricCols, template.metricKeywords, 2);
  if (matches.length === 0) return template.decisionText;
  return `${template.decisionText} (Focus: ${matches.map(humanizeColumnName).join(", ")})`;
}
