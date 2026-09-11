/**
 * Regression tests for lib/decision-templates.ts's resolveDecisionText() and
 * lib/data-analysis.ts's matchKeywordsToColumns().
 *
 * Run with:  npm run test:decision-templates
 *
 * Covers: "Are the Common Decisions questions actually customized based on
 * the attached CSV/Excel?" -- previously no: DECISION_TEMPLATES.metricKeywords
 * was inserted into the chip's hover tooltip only; the decisionText handed to
 * onChange() was always the same static string regardless of what was
 * uploaded, and the code's own doc-comment claiming otherwise was stale.
 * resolveDecisionText() now genuinely matches each template's keywords
 * against the loaded dataset's real business-metric columns (generic
 * token-overlap matching -- no per-dataset or per-domain hardcoding) and
 * names them in the inserted text.
 */

import { matchKeywordsToColumns, type Dataset } from "../lib/data-analysis.ts";
import { DECISION_TEMPLATES, resolveDecisionText } from "../lib/decision-templates.ts";

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL  ${name}${detail ? "  ->  " + detail : ""}`);
  }
}

function makeDataset(columns: string[]): Dataset {
  return { rows: [Object.fromEntries(columns.map((c) => [c, 1]))], columns };
}

const pricingTemplate = DECISION_TEMPLATES.find((t) => t.id === "pricing")!;
const retentionTemplate = DECISION_TEMPLATES.find((t) => t.id === "retention")!;
const riskTemplate = DECISION_TEMPLATES.find((t) => t.id === "risk")!;

// ── (a) No dataset at all -> plain template text, unchanged ─────────────────
{
  const text = resolveDecisionText(pricingTemplate);
  check("(a) no dataset -> unmodified decisionText", text === pricingTemplate.decisionText, text);
}

// ── (b) A retail dataset whose columns overlap the pricing keywords -> named ──
{
  const retail = makeDataset(["Category", "Profit Margin", "Discount", "Sales", "Order ID"]);
  const text = resolveDecisionText(pricingTemplate, retail);
  check("(b) retail dataset names its actual margin/discount columns",
    text === `${pricingTemplate.decisionText} (Focus: Profit Margin, Discount)`, text);
}

// ── (c) A dataset with NO overlapping columns -> falls back to plain text ───
{
  const healthcare = makeDataset(["Patient ID", "Readmission Rate", "Length Of Stay"]);
  const text = resolveDecisionText(pricingTemplate, healthcare);
  check("(c) no keyword overlap -> falls back to the plain template text",
    text === pricingTemplate.decisionText, text);
}

// ── (d) A different template against the SAME dataset picks different columns ──
{
  const retail = makeDataset(["Category", "Profit Margin", "Discount", "Customer Churn Rate", "Renewal Count"]);
  const pricingText = resolveDecisionText(pricingTemplate, retail);
  const retentionText = resolveDecisionText(retentionTemplate, retail);
  check("(d) two templates on the same dataset name DIFFERENT matched columns",
    pricingText.includes("Profit Margin") && retentionText.includes("Customer Churn Rate") && pricingText !== retentionText,
    `${pricingText} | ${retentionText}`);
}

// ── (e) Only ID/count-style columns present -> businessMetricColumns excludes them, so falls back ──
{
  const idOnly = makeDataset(["Row ID", "Order Count", "Customer ID"]);
  const text = resolveDecisionText(riskTemplate, idOnly);
  check("(e) dataset with only ID/count columns falls back to plain text", text === riskTemplate.decisionText, text);
}

// ── (f) matchKeywordsToColumns: ranks by overlap and respects the limit ─────
{
  const cols = ["Profit Margin", "Gross Margin Percent", "Discount Rate", "Units Sold", "Region"];
  const matches = matchKeywordsToColumns(cols, ["margin", "discount"], 2);
  check("(f) matches are capped at the given limit", matches.length <= 2, JSON.stringify(matches));
  check("(f) unrelated columns are never returned", !matches.includes("Units Sold") && !matches.includes("Region"), JSON.stringify(matches));
}

// ── (g) matchKeywordsToColumns: no keywords or no columns -> empty, no throw ──
{
  check("(g) empty keyword list -> no matches", matchKeywordsToColumns(["Profit Margin"], []).length === 0);
  check("(g) empty column list -> no matches", matchKeywordsToColumns([], ["margin"]).length === 0);
}

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
