import type { OutcomeRating } from "./decisions";

/**
 * Suggested outcome rating, from before / after / target.
 *
 * Why this exists: the outcome form used to open with "Met expectations"
 * already selected, so anyone who saved without touching it recorded a
 * success, which inflates the accuracy scorecard the product is judged on.
 * The rating now starts empty and is never filled in for the user. When they
 * give an optional target, this suggests one, with the rule spelled out so
 * they can see why and disagree.
 *
 * The rule (also shown in the UI):
 *   - Within 5% of the target counts as Met.
 *   - Past the target in the direction they were aiming counts as Exceeded.
 *   - Otherwise Fell short.
 *   - The direction is inferred from Value BEFORE to Target. That is why a
 *     target is required: before and after alone cannot say whether a decision
 *     meant to push a metric up (revenue) or down (churn).
 */

/** Within this fraction of the target counts as "Met". */
export const MET_TOLERANCE = 0.05;

export const RATING_RULE_TEXT =
  "Rule: within 5% of the target counts as Met. Past the target in the direction you were aiming counts as Exceeded. " +
  "Otherwise Fell short. The direction is taken from Value BEFORE to Target.";

export interface RatingSuggestion {
  rating: OutcomeRating;
  /** One sentence naming the rule that applied, with the real numbers. */
  rule: string;
}

export interface SuggestionResult {
  suggestion: RatingSuggestion | null;
  /** Why no suggestion could be made, when a target was given but is unusable. Null when there is nothing to say. */
  reason: string | null;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const isNum = (n: number | null): n is number => n !== null && Number.isFinite(n);

export function suggestOutcomeRating(
  before: number | null,
  after: number | null,
  target: number | null
): SuggestionResult {
  // No target given, or nothing to compare against it yet: say nothing.
  if (!isNum(target) || !isNum(after)) return { suggestion: null, reason: null };

  if (!isNum(before)) {
    return { suggestion: null, reason: "Add a Value BEFORE to get a suggested rating." };
  }
  if (target === 0) {
    return { suggestion: null, reason: "A suggestion needs a target other than 0." };
  }
  if (target === before) {
    return {
      suggestion: null,
      reason: "The target equals Value BEFORE, so the direction you were aiming cannot be inferred.",
    };
  }

  const diff = after - target;
  const pct = (Math.abs(diff) / Math.abs(target)) * 100;
  const where = `${fmt(after)} is ${pct.toFixed(1)}% ${diff >= 0 ? "above" : "below"} ${fmt(target)}`;

  // The epsilon keeps an exact-5% case (e.g. 1,235 vs 1,300) from flipping on
  // floating-point noise.
  if (Math.abs(diff) <= MET_TOLERANCE * Math.abs(target) + 1e-9 * Math.abs(target)) {
    return { suggestion: { rating: "met", rule: `Within 5% of the target (${where}).` }, reason: null };
  }

  const aimingUp = target > before;
  const pastTarget = aimingUp ? after > target : after < target;
  if (pastTarget) {
    return {
      suggestion: { rating: "exceeded", rule: `More than 5% past the target, in the direction you were aiming (${where}).` },
      reason: null,
    };
  }
  return {
    suggestion: { rating: "missed", rule: `More than 5% short of the target (${where}).` },
    reason: null,
  };
}
