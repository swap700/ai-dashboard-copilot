import { supabase } from "./supabase";
import type { ReportType } from "./report";

export type DecisionChoice = "approved" | "rejected" | "postponed";
export type OutcomeRating = "exceeded" | "met" | "missed";

const REPORT_PREFIX: Record<string, string> = {
  "Executive Summary":  "ES",
  "Operational Detail": "OD",
  "Risk Report":        "RR",
};

/** Returns a display ID like "ES-a3f9c1d2e4" given a report type and public_id token. */
export function formatDecisionId(reportType: string | null | undefined, publicId: string | null | undefined): string {
  if (!publicId) return "—";
  const prefix = (reportType && REPORT_PREFIX[reportType]) ?? "D";
  return `${prefix}-${publicId}`;
}

export interface DecisionRow {
  id: number;
  public_id: string;
  created_at: string;
  session_id: string | null;
  report_type: string | null;
  role: string | null;
  dataset_name: string | null;
  decision: string | null;
  notes: string | null;
  timeframe: string | null;
  question: string | null;
}

export interface LogDecisionParams {
  sessionId: string;
  reportType: ReportType;
  role: string;
  datasetName: string;
  choice: DecisionChoice;
  notes?: string;
  timeframe: string;
  question: string;
  // Added Task 13: which recommendation was acted on, and who owns it
  recommendation?: string;
  owner?: string;
  // Added Task 14: reason for postponing (Budget constraint / Need more data / Not a priority now)
  postponeReason?: string;
}

export interface LoggedDecision {
  id: number;
  publicId: string;
}

/**
 * Mirrors log_decision_record — returns the new row's internal id (used for
 * local write operations like outcome inserts) and its public_id token (used
 * for display and any cross-session lookup), or null if Supabase isn't
 * configured.
 *
 * Uses the log_decision_record() SECURITY DEFINER RPC instead of a direct
 * .insert().select("id") call, because anon has no SELECT grant on
 * nixara_decisions. A plain .insert().select() would be rolled back when the
 * subsequent SELECT fails RLS, leaving the table empty.  The RPC runs as the
 * table owner, does the INSERT internally, and returns the new id — anon only
 * needs EXECUTE on the function.
 */
export async function logDecisionRecord(params: LogDecisionParams): Promise<LoggedDecision | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("log_decision_record", {
    p_session_id:      params.sessionId,
    p_report_type:     params.reportType,
    p_role:            params.role,
    p_dataset_name:    params.datasetName,
    p_decision:        params.choice,
    p_notes:           params.notes ?? "",
    p_timeframe:       params.timeframe,
    p_question:        params.question,
    p_owner:           params.owner ?? null,
    p_recommendation:  params.recommendation ?? null,
    p_postpone_reason: params.postponeReason ?? null,
  });
  if (error || !data) return null;
  // RPC returns an array — unwrap the first row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { id: row.id as number, publicId: row.public_id as string };
}

export interface LogOutcomeParams {
  /**
   * The decision's public_id token, NOT its sequential internal id.
   * See the security note on logOutcome below.
   */
  publicId: string | null;
  sessionId: string;
  metricName: string;
  metricBefore: number | null;
  metricAfter: number | null;
  metricUnit: string;
  outcomeRating: OutcomeRating;
  notes?: string;
}

export interface LoggedOutcome {
  id: number;
  /** True when an outcome was already recorded for this decision; nothing was written. */
  alreadyExisted: boolean;
}

/**
 * Records an outcome against a decision, via the log_outcome_record
 * SECURITY DEFINER RPC.
 *
 * SECURITY FIX (H4 — write IDOR): this used to be a direct anon .insert() into
 * nixara_outcomes carrying a client-supplied `decision_id`, under a policy of
 * WITH CHECK (true) and with no ownership check. decision_id is a sequential
 * BIGSERIAL, so any caller could script 1, 2, 3 ... and attach fabricated
 * outcomes to every decision ever logged — and because
 * get_outcome_for_public_id returns the most recent outcome for a decision, a
 * legitimate user looking up their own decision would then be shown the
 * injected one. It also corrupts the accuracy record the product asks to be
 * judged on.
 *
 * Section 11 of the schema already established the right model for this: key
 * on the unguessable public_id token rather than the sequential id, so knowing
 * the token is the capability. That preserves the intentional cross-session
 * flow (logging an outcome for a decision from a previous session, found by
 * its ID) while removing the enumeration. anon no longer has INSERT on the
 * table at all.
 *
 * Returns null when Supabase is unconfigured or the token does not resolve.
 */
export async function logOutcome(params: LogOutcomeParams): Promise<LoggedOutcome | null> {
  if (!supabase || !params.publicId) return null;
  const { data, error } = await supabase.rpc("log_outcome_record", {
    p_public_id:      params.publicId,
    p_session_id:     params.sessionId,
    p_metric_name:    params.metricName,
    p_metric_before:  params.metricBefore,
    p_metric_after:   params.metricAfter,
    p_metric_unit:    params.metricUnit,
    p_outcome_rating: params.outcomeRating,
    p_notes:          params.notes ?? "",
  });
  if (error || !data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { id: row.id as number, alreadyExisted: Boolean(row.already_existed) };
}

/**
 * Looks up a decision by its public_id token via the get_decision_by_public_id
 * RPC. This is an intentionally cross-session lookup (the "find a decision
 * from a previous session" feature) — the token is a short random value
 * rather than the sequential internal id specifically so it can't be
 * enumerated. Returns null if not found or Supabase isn't configured.
 */
export async function fetchDecisionByPublicId(publicId: string): Promise<DecisionRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_decision_by_public_id", { p_public_id: publicId });
  if (error || !data) return null;
  const row = Array.isArray(data) ? (data[0] ?? null) : data;
  return row as DecisionRow | null;
}

/**
 * Updates the choice (approved/rejected/postponed) on an existing decision row
 * via the update_decision_choice SECURITY DEFINER RPC. The RPC now requires
 * the caller's sessionId to match the row's session_id — this is a WRITE, so
 * (unlike the public_id lookups above) there's no legitimate reason for one
 * session to be able to flip another session's decision. Returns true only
 * if a row was actually updated; false on error, missing config, or an
 * ownership mismatch.
 */
export async function updateDecisionChoice(
  id: number,
  sessionId: string,
  newChoice: DecisionChoice,
  postponeReason?: string
): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("update_decision_choice", {
    p_id:              id,
    p_decision:        newChoice,
    p_postpone_reason: postponeReason ?? null,
    p_session_id:      sessionId,
  });
  return !error && data === true;
}

export interface OutcomeRow {
  id: number;
  metric_name: string;
  metric_before: number | null;
  metric_after: number | null;
  metric_unit: string;
  outcome_rating: string;
  outcome_notes: string;
}

/**
 * Fetches the most recent outcome linked to a decision, via the
 * get_outcome_for_public_id SECURITY DEFINER RPC (anon has no SELECT on
 * nixara_outcomes directly). Keyed by the same public_id token as
 * fetchDecisionByPublicId, for the same enumeration-resistance reason —
 * the old sequential-id version of this RPC has been revoked server-side.
 * Returns null if none exists yet.
 */
export async function fetchOutcomeForPublicId(publicId: string): Promise<OutcomeRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_outcome_for_public_id", { p_public_id: publicId });
  if (error || !data) return null;
  const row = Array.isArray(data) ? (data[0] ?? null) : data;
  return row as OutcomeRow | null;
}

interface LogEventParams {
  sessionId: string;
  eventType: string;
  [key: string]: unknown;
}

/** Mirrors log_event (lines 71-87) — fire-and-forget analytics. */
export async function logEvent({ sessionId, eventType, ...rest }: LogEventParams): Promise<void> {
  if (!supabase) return;
  await supabase.from("nixara_events").insert({ session_id: sessionId, event_type: eventType, ...rest });
}
