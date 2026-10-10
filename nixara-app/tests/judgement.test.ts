/**
 * Regression tests for the three checks that decide what the model is
 * ALLOWED to claim: materiality, answerability and target arithmetic.
 *
 * Run with:  npm run test:judgement
 *
 * Every case here comes from a real report this product produced. Two of
 * them were confidently wrong in ways the verify-and-correct loop cannot
 * catch, because the loop checks that figures appear in the data and both
 * failures were claims with no figure attached:
 *
 *   "Cigna has the highest total billing amount" as the number one risk,
 *   on a file where all five insurers sat within 0.3 points of an even
 *   split and nothing correlated with billing at all.
 *
 *   "The financial burden from smoking-related conditions, although
 *   significant, is not as prominently delineated" on a file with no
 *   smoking column, followed by a ranking against chronic disease and a
 *   recommendation to raise premiums, from a file with no premium column.
 *
 * So each test asserts both directions: the noise case is refused AND the
 * real signal still gets through. A gate that blocks everything is not a
 * fix, it is a different failure.
 */

import { compareGroups, describeMateriality, describeMeasureDisagreement } from "../lib/materiality.ts";
import { checkAnswerability } from "../lib/answerability.ts";
import { parseTarget, computeScenarios, describeScenarios } from "../lib/scenario.ts";
import { buildDataSummary, dashboardScoreBreakdown, breakdownColumns, type Dataset } from "../lib/data-analysis.ts";

let pass = 0;
let fail = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) pass++;
  else { fail++; console.error(`  FAIL  ${name}${detail ? "  ->  " + detail : ""}`); }
}

/** Groups that differ only by chance, which is what the healthcare file was. */
function evenlySpread(groups: string[], rows = 600): Dataset {
  let seed = 11;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  return {
    columns: ["Group", "Amount"],
    rows: Array.from({ length: rows }, (_, i) => ({
      Group: groups[i % groups.length],
      Amount: 20000 + Math.round(next() * 10000),
    })),
  };
}

/** One group genuinely costs about twice the other, as smokers do. */
function realDifference(): Dataset {
  let seed = 23;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  return {
    columns: ["Smoker", "Cost"],
    rows: Array.from({ length: 600 }, (_, i) => {
      const smoker = i % 5 === 0;
      return { Smoker: smoker ? "Yes" : "No", Cost: (smoker ? 29000 : 15000) + Math.round(next() * 4000) };
    }),
  };
}

// ── Materiality ─────────────────────────────────────────────────────────────
console.log("materiality - a sorted list always has a top; that is not a finding");

const noise = compareGroups(evenlySpread(["Cigna", "Medicare", "Blue Cross", "UnitedHealthcare", "Aetna"]), "Group", "Amount", "sum")!;
check("evenly spread groups are called tied", noise.verdict === "tied",
  `${noise.verdict} var=${noise.varianceExplained}`);
check("and the model is told not to name one as a target",
  describeMateriality(noise).includes("Do NOT name a single"), describeMateriality(noise));
check("the sentence states how little the grouping explains",
  /explains <?0?\.?\d*% of the variation/.test(describeMateriality(noise)), describeMateriality(noise));

const real = compareGroups(realDifference(), "Smoker", "Cost", "mean")!;
check("a real difference is still called clear", real.verdict === "clear",
  `${real.verdict} var=${real.varianceExplained.toFixed(3)}`);
check("and is not hedged", !describeMateriality(real).includes("Do NOT"));

// The fault that made an earlier draft call a row-count difference "clear".
const lopsided: Dataset = {
  columns: ["Group", "Amount"],
  rows: [
    ...Array.from({ length: 500 }, () => ({ Group: "Big", Amount: 100 })),
    ...Array.from({ length: 100 }, () => ({ Group: "Small", Amount: 100 })),
  ],
};
const sizeOnly = compareGroups(lopsided, "Group", "Amount", "sum")!;
check("a group that is only bigger by row count is not a difference",
  sizeOnly.verdict === "tied", `${sizeOnly.verdict}`);

// An ordered scale: adjacent steps are close by definition, which must not
// be read as "no difference" when the scale as a whole explains a lot.
const scale: Dataset = {
  columns: ["Conditions", "Cost"],
  rows: Array.from({ length: 600 }, (_, i) => {
    const n = i % 6;
    return { Conditions: String(n), Cost: 15000 + n * 3000 + ((i * 37) % 900) };
  }),
};
const ordered = compareGroups(scale, "Conditions", "Cost", "mean")!;
check("an ordered scale with real spread is clear, despite close neighbours",
  ordered.verdict === "clear", `${ordered.verdict} gap=${ordered.gapToRunnerUp.toFixed(3)} var=${ordered.varianceExplained.toFixed(3)}`);

// Top by total vs top by average.
const flip: Dataset = {
  columns: ["Plan", "Cost"],
  rows: [
    ...Array.from({ length: 400 }, () => ({ Plan: "Standard", Cost: 1000 })),
    ...Array.from({ length: 50 }, () => ({ Plan: "Gold", Cost: 5000 })),
  ],
};
const flipped = compareGroups(flip, "Plan", "Cost", "sum")!;
check("the measure disagreement is detected", flipped.measureDisagrees);
check("and explained in words",
  (describeMeasureDisagreement(flipped) ?? "").includes("more rows, not because each one costs more"),
  describeMeasureDisagreement(flipped) ?? "(none)");
check("a breakdown where both agree gets no caution",
  describeMeasureDisagreement(compareGroups(realDifference(), "Smoker", "Cost", "mean")!) === null ||
  compareGroups(realDifference(), "Smoker", "Cost", "mean")!.measureDisagrees);

// ── Answerability ───────────────────────────────────────────────────────────
console.log("answerability - do not reason about a column that is not there");

const billing: Dataset = {
  columns: ["Medical Condition", "Insurance Provider", "Billing Amount"],
  rows: Array.from({ length: 60 }, (_, i) => ({
    "Medical Condition": ["Diabetes", "Cancer", "Asthma"][i % 3],
    "Insurance Provider": ["Cigna", "Aetna"][i % 2],
    "Billing Amount": 20000 + i,
  })),
};
const smokeQ = checkAnswerability(billing, "Is smoking or chronic disease the bigger cost driver, and which plan carries more risk than it is priced for?");
check("a column the file does not have is reported missing",
  smokeQ.missing.includes("smoking"), JSON.stringify(smokeQ.missing));
check("and the model is told not to call it influential",
  (smokeQ.note ?? "").includes("significant, influential, or a driver"), smokeQ.note ?? "");
check("and not to rank it against something real",
  (smokeQ.note ?? "").includes("A comparison needs both sides present"));
check("a column the file DOES have is not reported missing",
  !smokeQ.missing.includes("condition") && !smokeQ.missing.includes("billing"),
  JSON.stringify(smokeQ.missing));

// The false alarm that mattered: "smoking" against a column called "smoker".
const smokerFile: Dataset = {
  columns: ["smoker", "annual_medical_cost_usd"],
  rows: Array.from({ length: 60 }, (_, i) => ({ smoker: i % 4 ? "No" : "Yes", annual_medical_cost_usd: 15000 + i })),
};
check("a different form of the same word is NOT a false alarm",
  !checkAnswerability(smokerFile, "Rank smoking cessation by the saving it delivers").missing.includes("smoking"),
  JSON.stringify(checkAnswerability(smokerFile, "Rank smoking cessation by the saving it delivers").missing));
check("a value inside the file counts as present", (() => {
  const ds: Dataset = { columns: ["Status", "N"], rows: Array.from({ length: 30 }, (_, i) => ({ Status: ["Operating", "Closed"][i % 2], N: i })) };
  return !checkAnswerability(ds, "how many are Operating").missing.includes("operating");
})());
check("a question about nothing in particular raises no alarm",
  checkAnswerability(billing, "what should we do next quarter").note === null,
  JSON.stringify(checkAnswerability(billing, "what should we do next quarter").missing));

// ── Target arithmetic ───────────────────────────────────────────────────────
console.log("scenario - when the question states a target, do the arithmetic");

check("a cut target is read", parseTarget("cut costs by 8% this year")?.fraction === 0.08);
check("so is a spelled-out one", parseTarget("reduce spend by 10 percent")?.fraction === 0.1);
check("direction is read too", parseTarget("grow revenue by 12%")?.direction === "increase");
check("a bare percentage is NOT a target", parseTarget("margin is 40% of revenue") === null);
check("a number with no percent sign is not a target", parseTarget("cut costs by 8 next year") === null);

const scen = computeScenarios(realDifference(), "Cost", ["Smoker"], "cut cost by 8% this year")!;
check("the target is computed from the real total", Math.abs(scen.target.fraction - 0.08) < 1e-9);
check("the per-row target is the mean times the fraction",
  Math.abs(scen.targetPerRow - scen.overallMean * 0.08) < 1e-6);
check("a lever is sized from the gap and how many rows it covers", (() => {
  const l = scen.levers[0];
  return Math.abs(l.valuePerRow - l.gapPerRow * l.affectedShare) < 1e-6;
})());
check("and expressed against the stated target",
  scen.levers[0].coverOfTarget > 1, String(scen.levers[0].coverOfTarget));
check("the ceiling is labelled as a ceiling, not a forecast",
  describeScenarios(scen).includes("These are ceilings, not forecasts"));
check("and double counting is warned against",
  describeScenarios(scen).includes("never add two together"));
check("a tied grouping is never offered as a lever",
  computeScenarios(evenlySpread(["A", "B", "C"]), "Amount", ["Group"], "cut amount by 10%")!.levers.length === 0);
check("with no target in the question there is no arithmetic",
  computeScenarios(realDifference(), "Cost", ["Smoker"], "which group costs more") === null);

// ── Wired into the summary ──────────────────────────────────────────────────
console.log("summary - the question decides what the model is shown");

const twoMetrics: Dataset = {
  columns: ["smoker", "region", "annual_income_usd", "annual_medical_cost_usd"],
  rows: Array.from({ length: 300 }, (_, i) => {
    const smoker = i % 5 === 0;
    return {
      smoker: smoker ? "Yes" : "No",
      region: ["N", "S", "E"][i % 3],
      annual_income_usd: 60000 + ((i * 131) % 20000),
      annual_medical_cost_usd: (smoker ? 29000 : 15000) + ((i * 37) % 3000),
    };
  }),
};
const summary = buildDataSummary(twoMetrics, { decisionText: "cut annual medical cost by 8% by targeting smoking" });
// The named metric must LEAD each breakdown. The other metric still appears
// underneath as context, which is useful; what must not happen is the
// unnamed one being treated as the subject, which is what put a whole report
// about patient age on screen when the question was about cost.
check("the named metric leads every breakdown", (() => {
  const blocks = summary.split(/^BREAKDOWN BY /m).slice(1);
  return blocks.length > 0 && blocks.every((b) => {
    const firstFigure = b.split("\n").find((l) => /^ {2}(TOTAL|AVERAGE) /.test(l));
    return !!firstFigure && firstFigure.includes("annual_medical_cost_usd");
  });
})(), summary.split("\n").filter((l) => /^ {2}(TOTAL|AVERAGE) /.test(l)).slice(0, 2).join(" | "));
check("the target arithmetic is present", summary.includes("TARGET ARITHMETIC"));
check("and names the metric the question named",
  /cut annual_medical_cost_usd by 8%/.test(summary), summary.split("\n").find((l) => l.includes("The question asks")) ?? "");
check("a materiality verdict accompanies every breakdown", (() => {
  const blocks = summary.split("\n").filter((l) => l.startsWith("BREAKDOWN BY")).length;
  const verdicts = summary.split("\n").filter((l) => /NO MEANINGFUL|CLEAR DIFFERENCE|WEAK DIFFERENCE/.test(l)).length;
  return blocks > 0 && verdicts >= blocks;
})(), "(a breakdown shipped without a verdict)");

check("a count column can key a breakdown as well as be a metric", (() => {
  const ds: Dataset = {
    columns: ["chronic_diseases", "region", "cost"],
    rows: Array.from({ length: 300 }, (_, i) => ({
      chronic_diseases: i % 5, region: ["N", "S"][i % 2], cost: 15000 + (i % 5) * 3000,
    })),
  };
  return breakdownColumns(ds).includes("chronic_diseases");
})());

// ── Quality score: rows that should not be counted ──────────────────────────
console.log("quality - duplicates and negatives");

const wide = (rows: number, dupes: number, negs: number): Dataset => {
  const cols = Array.from({ length: 10 }, (_, i) => `C${i}`);
  const base = Array.from({ length: rows }, (_, i) =>
    Object.fromEntries(cols.map((c, j) => [c, j === 9 ? 100 + i : `v${(i * (j + 1)) % 97}`])));
  for (let i = 0; i < dupes; i++) base.push({ ...base[i] });
  for (let i = 0; i < negs; i++) base[i].C9 = -50;
  return { columns: cols, rows: base as Dataset["rows"] };
};
check("exact duplicate rows are penalised on a wide file",
  dashboardScoreBreakdown(wide(200, 20, 0)).reasons.some((r) => r.key === "duplicateRows"));
check("and the count is stated",
  (dashboardScoreBreakdown(wide(200, 20, 0)).reasons.find((r) => r.key === "duplicateRows")?.message ?? "").includes("20 rows"));
check("negative values in a metric are flagged",
  dashboardScoreBreakdown(wide(200, 0, 5)).reasons.some((r) => r.key === "negativeValues"));
check("a narrow file is NOT accused of duplicates for ordinary repeats", (() => {
  const ds: Dataset = {
    columns: ["Region", "Category", "Sales"],
    rows: Array.from({ length: 200 }, (_, i) => ({ Region: ["N", "S"][i % 2], Category: ["A", "B"][i % 2], Sales: 100 })),
  };
  return !dashboardScoreBreakdown(ds).reasons.some((r) => r.key === "duplicateRows");
})());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
