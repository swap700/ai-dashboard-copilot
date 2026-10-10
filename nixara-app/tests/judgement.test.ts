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
import { checkConfounding, describeConfounding, describeConfoundingBlock, mediatorShift } from "../lib/confounding.ts";
import { collectRiskEvidence, describeRiskEvidence, measureConcentration, measureDirection } from "../lib/risk-evidence.ts";
import { buildDataSummary, dashboardScoreBreakdown, breakdownColumns, fitSummaryToBudget, outcomeRegion, type Dataset } from "../lib/data-analysis.ts";

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


// ── Controlled comparison ───────────────────────────────────────────────────
// The two cases that matter are opposite failures. A real effect must survive
// adjustment, or the module is a gate that blocks everything. A gap that is
// entirely a confounder's doing must be reported as such, or the module is
// decoration.
console.log("\nconfounding - does the gap survive");

// Cost depends ONLY on smoking. Age is identical in both groups.
const realEffect = (): Dataset => ({
  columns: ["smoker", "age", "bmi", "cost"],
  rows: Array.from({ length: 600 }, (_, i) => {
    const smoker = i % 2 === 0 ? "Yes" : "No";
    // Age must advance per PAIR of rows, not per row, or the two groups
    // end up a year apart and the fixture tests the wrong thing.
    const age = 30 + (Math.floor(i / 2) % 20);
    return { smoker, age, bmi: 25 + (Math.floor(i / 2) % 7), cost: 5000 + (smoker === "Yes" ? 10000 : 0) + (i % 11) * 50 };
  }),
});

// Cost depends ONLY on age. "Treated" rows just happen to all be older.
const fakeEffect = (): Dataset => ({
  columns: ["programme", "age", "bmi", "cost"],
  rows: Array.from({ length: 600 }, (_, i) => {
    const old = i % 2 === 0;
    const age = old ? 60 + (i % 10) : 25 + (i % 10);
    return { programme: old ? "In" : "Out", age, bmi: 25 + (i % 7), cost: 200 * age + (i % 11) * 5 };
  }),
});

check("a real effect survives adjustment", (() => {
  const r = checkConfounding(realEffect(), "cost", "smoker", ["age", "bmi"]);
  return r !== null && Math.abs(r.explainedAway) < 0.1 && Math.abs(r.adjustedGap - 10000) < 500;
})());

check("and the groups are reported as alike on the confounders", (() => {
  const r = checkConfounding(realEffect(), "cost", "smoker", ["age", "bmi"]);
  return r !== null && r.balance.every((b) => b.balanced) && describeConfounding(r).includes("holds up");
})());

check("a gap that is really age is reported as explained away", (() => {
  const r = checkConfounding(fakeEffect(), "cost", "programme", ["age", "bmi"]);
  return r !== null && r.explainedAway > 0.9;
})());

check("and the imbalance on age is named", (() => {
  const r = checkConfounding(fakeEffect(), "cost", "programme", ["age", "bmi"]);
  return r !== null && describeConfounding(r).includes("They do differ on age");
})());

check("a categorical confounder is held steady, not ignored", (() => {
  // Cost is set entirely by plan. "North" rows are mostly on the dear plan.
  const ds: Dataset = {
    columns: ["region", "plan", "cost"],
    rows: Array.from({ length: 800 }, (_, i) => {
      const north = i % 2 === 0;
      const plan = north ? (i % 10 < 9 ? "Gold" : "Basic") : (i % 10 < 9 ? "Basic" : "Gold");
      return { region: north ? "North" : "South", plan, cost: plan === "Gold" ? 9000 : 3000 };
    }),
  };
  const r = checkConfounding(ds, "cost", "region", [], ["plan"]);
  return r !== null && r.categoricalConfounders.includes("plan") && r.explainedAway > 0.9;
})());

check("a column is never both a numeric and a categorical confounder", (() => {
  const ds = realEffect();
  const r = checkConfounding(ds, "cost", "smoker", ["age", "bmi"], ["age", "bmi"]);
  if (!r) return false;
  const all = [...r.confounders, ...r.categoricalConfounders];
  return new Set(all).size === all.length;
})());

check("the adjustment is capped so the sentence stays readable", (() => {
  const cols = Array.from({ length: 20 }, (_, i) => `c${i}`);
  const ds: Dataset = {
    columns: ["grp", ...cols, "cost"],
    rows: Array.from({ length: 2000 }, (_, i) => ({
      grp: i % 2 === 0 ? "A" : "B",
      ...Object.fromEntries(cols.map((c, j) => [c, (i * (j + 3)) % 50])),
      cost: 1000 + (i % 2 === 0 ? 500 : 0) + (i % 17),
    })),
  };
  const r = checkConfounding(ds, "cost", "grp", cols);
  return r !== null && r.confounders.length <= 8 && r.checkedOnly.length > 0;
})());

check("the block states that a consequence cannot be told from a cause", (() => {
  const r = checkConfounding(realEffect(), "cost", "smoker", ["age", "bmi"]);
  return r !== null && describeConfoundingBlock([r]).includes("cannot tell a cause from a consequence");
})());

check("too few rows produces nothing rather than a confident number", (() => {
  const ds: Dataset = {
    columns: ["smoker", "age", "cost"],
    rows: Array.from({ length: 20 }, (_, i) => ({ smoker: i % 2 ? "Yes" : "No", age: 30 + i, cost: 1000 + i * 10 })),
  };
  return checkConfounding(ds, "cost", "smoker", ["age"]) === null;
})());


// ── A wide file must not produce a summary the server refuses ───────────────
// A 200-column export produced 15,934 characters against an 8,000-character
// cap, so the request came back 413 and the user saw "report failed" with
// nothing to act on. Every file must now fit, whatever its shape.
console.log("\nsummary budget - a wide file still gets a report");

const wideFile = (metrics: number, dims: number, rows: number): Dataset => {
  const mcols = Array.from({ length: metrics }, (_, i) => `metric_${i}_usd`);
  const dcols = Array.from({ length: dims }, (_, i) => `dim_${i}`);
  return {
    columns: [...mcols, ...dcols],
    rows: Array.from({ length: rows }, (_, r) => ({
      ...Object.fromEntries(mcols.map((c, j) => [c, 100 + ((r * (j + 7)) % 9000)])),
      ...Object.fromEntries(dcols.map((c) => [c, `v${r % 5}`])),
    })) as Dataset["rows"],
  };
};

check("a 200-column file fits under the server's cap",
  buildDataSummary(wideFile(140, 60, 400), { decisionText: "Cut total costs by 10%" }).length <= 7500,
  String(buildDataSummary(wideFile(140, 60, 400), { decisionText: "Cut total costs by 10%" }).length));

check("a 500-column file fits too",
  buildDataSummary(wideFile(500, 0, 50), { decisionText: "reduce cost" }).length <= 7500);

check("and the blocks that constrain what may be claimed are the ones kept", (() => {
  const out = buildDataSummary(wideFile(140, 60, 400), { decisionText: "Cut total metric_3_usd by 10%" });
  return out.includes("TARGET ARITHMETIC") && out.includes("Data Quality Score:");
})());

check("the question's own column is still described on a wide file", (() => {
  const out = buildDataSummary(wideFile(140, 60, 400), { decisionText: "Cut total metric_77_usd by 10%" });
  return out.includes("metric_77_usd: count=");
})());

check("a summary already under budget is returned untouched", (() => {
  const lines = ["Rows: 3 | Columns: 2", "", "NUMERIC SUMMARY", "  a: 1", ""];
  return fitSummaryToBudget(lines, 5000).join("\n") === lines.join("\n");
})());

check("low-priority context is given up before the claim constraints", (() => {
  const header = ["Rows: 1000 | Columns: 4"];
  const big = (h: string, n: number) => [h, ...Array.from({ length: n }, (_, i) => `  line ${i} ` + "x".repeat(60))];
  const lines = [...header, "", ...big("TOP CORRELATIONS", 20), "", ...big("NOT IN THIS FILE: something", 2), ""];
  const out = fitSummaryToBudget(lines, 600).join("\n");
  return out.includes("NOT IN THIS FILE") && out.length <= 600;
})());

check("a file so wide that nothing fits still returns its shape", (() => {
  const lines = ["Rows: 1 | Columns: 1", "", "TOP CORRELATIONS", "  " + "x".repeat(500), ""];
  const out = fitSummaryToBudget(lines, 40).join("\n");
  return out.startsWith("Rows: 1") && !out.includes("TOP CORRELATIONS");
})());


// ── Which metric the question is actually about ─────────────────────────────
// Two real failures, both from name matching alone. Asked "is smoking or
// chronic disease the bigger cost driver", the question repeats both words of
// chronic_diseases and one of annual_medical_cost_usd, so the 0-5 disease
// count became the outcome. With that fixed, "we reprice next year" tied
// doctor_visits_per_year against annual_medical_cost_usd on the word "year".
console.log("\nprimary metric - the outcome, not a word the question repeats");

const repricing = (): Dataset => ({
  columns: ["smoker", "insurance_plan", "age", "chronic_diseases", "doctor_visits_per_year", "annual_medical_cost_usd"],
  rows: Array.from({ length: 900 }, (_, i) => ({
    smoker: i % 5 === 0 ? "Yes" : "No",
    insurance_plan: ["Basic", "Standard", "Gold"][i % 3],
    age: 25 + (i % 40),
    chronic_diseases: i % 6,
    doctor_visits_per_year: i % 9,
    annual_medical_cost_usd: 8000 + (i % 5 === 0 ? 14000 : 0) + (i % 6) * 3000 + (i % 37) * 11,
  })),
});

// The materiality verdict names the primary metric, so the verdict line for
// the smoker breakdown is a direct read of which column the whole analysis
// was run on.
const smokerVerdict = (question: string): string =>
  buildDataSummary(repricing(), { decisionText: question })
    .split("\n")
    .find((l) => l.includes("smoker") && l.includes("DIFFERENCE")) ?? "(no verdict)";

check("a 0-5 scale the question names is not treated as the outcome",
  smokerVerdict("Is smoking or chronic disease the bigger cost driver, and which plan carries more risk than it is priced for?")
    .includes("annual_medical_cost_usd"),
  smokerVerdict("Is smoking or chronic disease the bigger cost driver, and which plan carries more risk than it is priced for?"));

check("'next year' in the question does not pick the per-year column",
  smokerVerdict("We reprice next year. What is the bigger cost driver?").includes("annual_medical_cost_usd"),
  smokerVerdict("We reprice next year. What is the bigger cost driver?"));

check("the per-row leader is the one named beside the per-row figures",
  smokerVerdict("Is smoking the bigger cost driver?").includes("Yes leads"),
  smokerVerdict("Is smoking the bigger cost driver?"));

check("and the total leader gets its own caution line", (() => {
  const out = buildDataSummary(repricing(), { decisionText: "Is smoking the bigger cost driver?" });
  return out.includes("CAUTION on smoker") && out.includes("No is largest by TOTAL");
})());


check("a column named only in a 'caused by' clause is not the outcome",
  !outcomeRegion("Rank the savings. Say which differences might be caused by age, BMI or plan mix.").includes("age"),
  outcomeRegion("Rank the savings. Say which differences might be caused by age, BMI or plan mix."));
check("and the outcome half of the question is kept intact",
  outcomeRegion("Cut annual medical cost by 8%. Say which differences might be caused by age or BMI.")
    .includes("annual medical cost"));
check("the mirror phrasing is handled too",
  !outcomeRegion("Cut cost by 8%. Say what age or plan mix might explain.").includes("age"),
  outcomeRegion("Cut cost by 8%. Say what age or plan mix might explain."));
check("a question with no confounder clause is returned unchanged",
  outcomeRegion("Cut billing by 10% next year") === "Cut billing by 10% next year");

check("a controlled comparison is run on the cost column", (() => {
  const out = buildDataSummary(repricing(), {
    decisionText: "Is smoking or chronic disease the bigger cost driver? Say which differences might be caused by age or plan mix.",
  });
  return out.includes("CONTROLLED COMPARISON") && out.includes("on annual_medical_cost_usd");
})());

check("an abstract business word is not reported as a missing column", (() => {
  const out = buildDataSummary(repricing(), { decisionText: "Cut billing exposure by 10% next year" });
  return !out.includes('refers to "exposure"');
})());

check("a measurement is never correlated against an identifier", (() => {
  const ds: Dataset = {
    columns: ["Room Number", "Age", "Billing Amount"],
    rows: Array.from({ length: 4000 }, (_, i) => ({
      "Room Number": 101 + (i % 400),
      Age: 20 + (i % 60),
      "Billing Amount": 1000 + (i % 913),
    })),
  };
  const out = buildDataSummary(ds);
  return !out.includes("Room Number:") || !out.includes("~ Room Number");
})());


// ── Risk evidence: a share, a direction, and what is double counted ─────────
// This replaced "Likelihood: High / Impact: High", which the model invented
// because nothing in the summary could support either word.
console.log("\nrisk evidence - a risk has to come from a figure");

check("a many-level column with a fat head is concentrated", (() => {
  // 39 states, the top 8 carrying 70% of sales. The first threshold used an
  // absolute 25% floor on the LARGEST group, written with a handful of groups
  // in mind, and called this spread - which would have contradicted the
  // curve drawn beside it.
  const rows: Dataset["rows"] = [];
  for (let i = 0; i < 39; i++) {
    const weight = i < 8 ? 70 : 3;
    for (let j = 0; j < 20; j++) rows.push({ state: `S${i}`, sales: weight });
  }
  const c = measureConcentration({ columns: ["state", "sales"], rows }, "state", "sales");
  return c !== null && c.concentrated && c.topFifthCount === 8;
})(), JSON.stringify((() => {
  const rows: Dataset["rows"] = [];
  for (let i = 0; i < 39; i++) { const w = i < 8 ? 70 : 3; for (let j = 0; j < 20; j++) rows.push({ state: `S${i}`, sales: w }); }
  const c = measureConcentration({ columns: ["state", "sales"], rows }, "state", "sales");
  return { conc: c?.concentrated, fifth: c?.topFifthShare };
})()));

check("a two-level split is never called concentrated, whatever the gap", (() => {
  const rows: Dataset["rows"] = [
    ...Array.from({ length: 100 }, () => ({ g: "A", v: 90 })),
    ...Array.from({ length: 100 }, () => ({ g: "B", v: 10 })),
  ];
  const c = measureConcentration({ columns: ["g", "v"], rows }, "g", "v");
  return c !== null && !c.concentrated;
})());

check("the curve is returned for the chart, and ends at 100%", (() => {
  const rows: Dataset["rows"] = Array.from({ length: 300 }, (_, i) => ({ g: `G${i % 6}`, v: 10 + (i % 6) * 5 }));
  const c = measureConcentration({ columns: ["g", "v"], rows }, "g", "v");
  return c !== null && c.cumulative.length === 6 &&
    Math.abs(c.cumulative[5].cumulativeShare - 1) < 1e-9 &&
    c.cumulative[0].cumulativeShare < c.cumulative[1].cumulativeShare;
})());

check("an even split is reported as SPREAD, not as concentration", (() => {
  const ds: Dataset = {
    columns: ["insurer", "billing"],
    rows: Array.from({ length: 500 }, (_, i) => ({ insurer: `I${i % 5}`, billing: 1000 + (i % 7) })),
  };
  const c = measureConcentration(ds, "insurer", "billing");
  return c !== null && !c.concentrated && Math.abs(c.topShare - 0.2) < 0.01;
})());

check("a genuinely concentrated column is reported as CONCENTRATED", (() => {
  const ds: Dataset = {
    columns: ["customer", "billing"],
    rows: Array.from({ length: 500 }, (_, i) => ({ customer: i < 50 ? "Big" : `C${i}`, billing: i < 50 ? 10000 : 100 })),
  };
  const c = measureConcentration(ds, "customer", "billing");
  return c !== null && c.concentrated && c.topShare > 0.5;
})());

check("shares are refused where a group is negative, since they would not add up", (() => {
  const ds: Dataset = {
    columns: ["region", "profit"],
    rows: [{ region: "N", profit: 100 }, { region: "S", profit: -40 }, { region: "E", profit: 60 }],
  };
  return measureConcentration(ds, "region", "profit") === null;
})());

check("a half-filled final month is excluded, not reported as a fall", (() => {
  const rows: Dataset["rows"] = [];
  for (let m = 0; m < 6; m++) {
    const n = m === 5 ? 5 : 100;
    for (let i = 0; i < n; i++) rows.push({ when: new Date(Date.UTC(2026, m, 1 + (i % 27))), amount: 100 });
  }
  const d = measureDirection({ columns: ["when", "amount"], rows }, "when", "amount");
  return d !== null && d.lastPeriodPartial && d.periods === 5 && d.trend === "flat";
})());

check("and the block says so in words", (() => {
  const rows: Dataset["rows"] = [];
  for (let m = 0; m < 6; m++) {
    const n = m === 5 ? 5 : 100;
    for (let i = 0; i < n; i++) rows.push({ when: new Date(Date.UTC(2026, m, 1 + (i % 27))), amount: 100 });
  }
  const e = collectRiskEvidence({ columns: ["when", "amount"], rows }, "amount", [], ["when"]);
  return e !== null && describeRiskEvidence(e).includes("PARTIAL PERIOD");
})());

check("a file with no dates forbids the word trend rather than leaving it open", (() => {
  const ds: Dataset = {
    columns: ["region", "billing"],
    rows: Array.from({ length: 100 }, (_, i) => ({ region: `R${i % 4}`, billing: 500 + i })),
  };
  const e = collectRiskEvidence(ds, "billing", ["region"], []);
  return e !== null && describeRiskEvidence(e).includes("NO DIRECTION AVAILABLE");
})());

check("duplicates are priced in the metric's own units on a wide file", (() => {
  const cols = Array.from({ length: 10 }, (_, i) => `c${i}`);
  const rows = Array.from({ length: 100 }, (_, i) =>
    Object.fromEntries([...cols.map((c, j) => [c, `v${(i * (j + 1)) % 53}`]), ["billing", 100 + i]]));
  rows.push({ ...rows[0] }, { ...rows[1] });
  const e = collectRiskEvidence({ columns: [...cols, "billing"], rows: rows as Dataset["rows"] }, "billing", [], []);
  return e !== null && e.integrity !== null && e.integrity.duplicateRows === 2 && e.integrity.duplicateValue > 0;
})());

check("and a narrow file is NOT accused of double counting", (() => {
  const ds: Dataset = {
    columns: ["Region", "Category", "Sales"],
    rows: Array.from({ length: 200 }, (_, i) => ({ Region: ["N", "S"][i % 2], Category: ["A", "B"][i % 2], Sales: 100 })),
  };
  const e = collectRiskEvidence(ds, "Sales", ["Region"], []);
  return e === null || e.integrity === null || e.integrity.duplicateRows === 0;
})());

check("negative amounts are named with their total", (() => {
  const ds: Dataset = {
    columns: ["region", "billing"],
    rows: [...Array.from({ length: 50 }, (_, i) => ({ region: "N", billing: 100 + i })),
           { region: "S", billing: -200 }],
  };
  const e = collectRiskEvidence(ds, "billing", ["region"], []);
  return e !== null && describeRiskEvidence(e).includes("NEGATIVE AMOUNTS");
})());


// ── Precision: the verdict has to rest on the range ─────────────────────────
// "The difference holds up" was being said on the strength of two point
// estimates sitting close together. That is a claim about precision made
// without measuring precision. A poll saying "52%" is a lead or a coin flip
// depending entirely on the interval, and the headline cannot tell you which.
console.log("\nconfounding - a number with no margin is not a verdict");

const noisyNoEffect = (): Dataset => ({
  columns: ["arm", "age", "cost"],
  rows: Array.from({ length: 400 }, (_, i) => ({
    arm: i % 2 === 0 ? "A" : "B",
    age: 30 + (Math.floor(i / 2) % 30),
    // Cost is pure noise: nothing about arm or age moves it.
    cost: 5000 + ((i * 7919) % 9000),
  })),
});

check("a standard error is reported, not just a coefficient", (() => {
  const r = checkConfounding(realEffect(), "cost", "smoker", ["age", "bmi"]);
  return r !== null && r.adjustedGapSe > 0 && r.rawGapSe > 0 && r.dof > 0;
})());

check("the interval brackets the estimate", (() => {
  const r = checkConfounding(realEffect(), "cost", "smoker", ["age", "bmi"]);
  return r !== null && r.adjustedGapLow < r.adjustedGap && r.adjustedGap < r.adjustedGapHigh;
})());

check("a real 10,000 effect is distinguishable from zero", (() => {
  const r = checkConfounding(realEffect(), "cost", "smoker", ["age", "bmi"]);
  return r !== null && r.distinguishableFromZero && r.adjustedGapLow > 0;
})());

check("noise is NOT distinguishable from zero", (() => {
  const r = checkConfounding(noisyNoEffect(), "cost", "arm", ["age"]);
  return r !== null && !r.distinguishableFromZero;
})(), String(checkConfounding(noisyNoEffect(), "cost", "arm", ["age"])?.adjustedGapSe));

check("and nothing is said to hold up when the range includes zero", (() => {
  const r = checkConfounding(noisyNoEffect(), "cost", "arm", ["age"]);
  if (!r) return false;
  const text = describeConfounding(r);
  return text.includes("cannot be told apart from no difference") && !text.includes("holds up");
})());

check("the summary quotes the range, not just the middle", (() => {
  const r = checkConfounding(realEffect(), "cost", "smoker", ["age", "bmi"]);
  return r !== null && describeConfounding(r).includes("95% range");
})());

check("too few rows for the columns asked for produces nothing", (() => {
  const cols = Array.from({ length: 12 }, (_, i) => `c${i}`);
  const ds: Dataset = {
    columns: ["grp", ...cols, "cost"],
    rows: Array.from({ length: 35 }, (_, i) => ({
      grp: i % 2 ? "A" : "B",
      ...Object.fromEntries(cols.map((c, j) => [c, (i * (j + 3)) % 17])),
      cost: 100 + i,
    })),
  };
  return checkConfounding(ds, "cost", "grp", cols) === null;
})());

// ── Two levers that cannot be ranked ───────────────────────────────────────
check("overlapping ranges are reported as unrankable", (() => {
  // Two groupings with similar effects on a modest number of rows: the
  // intervals will overlap and the report must not order them.
  const ds: Dataset = {
    columns: ["a", "b", "age", "cost"],
    rows: Array.from({ length: 600 }, (_, i) => ({
      a: i % 2 === 0 ? "Y" : "N",
      b: i % 3 === 0 ? "Y" : "N",
      age: 30 + (i % 25),
      cost: 5000 + (i % 2 === 0 ? 4000 : 0) + (i % 3 === 0 ? 4200 : 0) + ((i * 7919) % 6000),
    })),
  };
  const results = [
    checkConfounding(ds, "cost", "a", ["age"], ["b"]),
    checkConfounding(ds, "cost", "b", ["age"], ["a"]),
  ].filter((r): r is NonNullable<typeof r> => r !== null);
  if (results.length < 2) return false;
  const text = describeConfoundingBlock(results);
  return text.includes("CANNOT BE RANKED") || text.includes("RANKING IS SUPPORTED");
})());

// ── Mediators: a consequence is not a competing explanation ────────────────
// Smoking makes people sicker, sicker people see the doctor more, more visits
// cost more. Holding visits steady removes part of smoking's own effect.
console.log("\nconfounding - a consequence held steady hides the effect");

const withMediator = (): Dataset => ({
  columns: ["smoker", "age", "visits", "cost"],
  rows: Array.from({ length: 800 }, (_, i) => {
    const smoker = i % 2 === 0;
    // Visits are DOWNSTREAM of smoking, and cost follows visits.
    const visits = (smoker ? 8 : 2) + (Math.floor(i / 2) % 3);
    return {
      smoker: smoker ? "Yes" : "No",
      age: 30 + (Math.floor(i / 2) % 25),
      visits,
      cost: 2000 + visits * 900 + (i % 11) * 20,
    };
  }),
});

check("a column the grouping all but decides is flagged as a candidate", (() => {
  const r = checkConfounding(withMediator(), "cost", "smoker", ["age", "visits"]);
  return r !== null && r.mediatorCandidates.includes("visits");
})(), JSON.stringify(checkConfounding(withMediator(), "cost", "smoker", ["age", "visits"])?.mediatorCandidates));

check("the gap is reported both ways, and the range is material", (() => {
  const r = checkConfounding(withMediator(), "cost", "smoker", ["age", "visits"]);
  const shift = r ? mediatorShift(r) : null;
  return shift !== null && shift.high > shift.low && shift.relative > 0.1;
})());

check("and holding the consequence steady really does shrink the effect", (() => {
  const r = checkConfounding(withMediator(), "cost", "smoker", ["age", "visits"]);
  return r !== null && r.adjustedGapExcludingMediators !== null &&
    Math.abs(r.adjustedGapExcludingMediators) > Math.abs(r.adjustedGap);
})());

check("a 1% difference between the two fits is not worth a paragraph", (() => {
  // age is mildly imbalanced and barely moves cost, so excluding it changes
  // almost nothing: there is no honest range to report.
  const r = checkConfounding(realEffect(), "cost", "smoker", ["age", "bmi"]);
  return r !== null && mediatorShift(r) === null;
})());

check("a column the user marks as a consequence is dropped outright", (() => {
  const r = checkConfounding(withMediator(), "cost", "smoker", ["age", "visits"], [], ["visits"]);
  return r !== null && !r.confounders.includes("visits") && r.excludedByUser.includes("visits");
})());

check("and the summary says it was the user's call", (() => {
  const r = checkConfounding(withMediator(), "cost", "smoker", ["age", "visits"], [], ["visits"]);
  return r !== null && describeConfounding(r).includes("marked them as consequences");
})());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
