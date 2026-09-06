/**
 * Decision Templates — a lookup table, not a modeling system. Each template
 * maps a common decision-type to a ready-to-edit decision question plus the
 * metric-name keywords that kind of decision usually turns on. Selecting one
 * pre-fills the Decision Context field in ReportSetup; the keyword list is
 * reused to bias selectChartColumns' relevance scoring (lib/data-analysis.ts)
 * toward the columns that actually matter for that kind of call, on top of
 * whatever overlap the free-text decision already produces.
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
