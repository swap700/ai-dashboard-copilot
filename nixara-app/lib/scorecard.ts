/**
 * Outcome Engine / Decision Scorecard — pure aggregation over the same
 * DecisionWithOutcome[] the Decision Memory page already fetches. No new
 * plumbing: this is "aggregation + a chart" over data list_decisions_for_session
 * (lib/decisions.ts) already returns.
 *
 * Only approved decisions are ever counted toward accuracy — see the H6 fix
 * in log_outcome_record (nixara_supabase_setup.sql, section 16). A rejected
 * or postponed decision can never have an outcome row at all now, but this
 * file adds its own belt-and-suspenders filter rather than trusting that
 * invariant blindly, since a scorecard is exactly the place a stale
 * assumption would go unnoticed.
 */

import type { DecisionWithOutcome } from "./decisions";

export interface ScorecardStats {
  totalDecisions: number;
  byChoice: { approved: number; rejected: number; postponed: number };
  scoredCount: number; // approved decisions with an outcome logged
  unscoredApprovedCount: number; // approved but no outcome yet
  byRating: { exceeded: number; met: number; missed: number };
  /** exceeded+met as a share of scoredCount, 0-100, or null if nothing scored yet. */
  accuracyPct: number | null;
}

export function computeScorecard(decisions: DecisionWithOutcome[]): ScorecardStats {
  const byChoice = { approved: 0, rejected: 0, postponed: 0 };
  const byRating = { exceeded: 0, met: 0, missed: 0 };
  let scoredCount = 0;
  let unscoredApprovedCount = 0;

  for (const d of decisions) {
    if (d.decision === "approved") byChoice.approved++;
    else if (d.decision === "rejected") byChoice.rejected++;
    else if (d.decision === "postponed") byChoice.postponed++;

    // Belt-and-suspenders: only count an outcome if the decision is ALSO
    // approved, regardless of what the row says. See file header.
    if (d.decision === "approved" && d.outcome) {
      scoredCount++;
      const rating = d.outcome.outcome_rating as keyof typeof byRating;
      if (rating in byRating) byRating[rating]++;
    } else if (d.decision === "approved" && !d.outcome) {
      unscoredApprovedCount++;
    }
  }

  const accuracyPct =
    scoredCount > 0 ? Math.round(((byRating.exceeded + byRating.met) / scoredCount) * 100) : null;

  return {
    totalDecisions: decisions.length,
    byChoice,
    scoredCount,
    unscoredApprovedCount,
    byRating,
    accuracyPct,
  };
}
