import { supabase } from "./supabase";
import type { ReportType } from "./report";

export type DecisionChoice = "approved" | "rejected" | "postponed";
export type OutcomeRating = "exceeded" | "met" | "missed";

const REPORT_PREFIX: Record<string, string> = {
  "Executive Summary":  "ES",
  "Operational Detail": "OD",
  "Risk Report":        "RR",
};

/** Returns a display ID like "ES-19" given a report type and numeric DB id. */
export function formatDecisionId(reportType: string | null | undefined, id: number | null | undefined): string {
  if (!id) return "—";
  const prefix = (reportType && REPORT_PREFIX[reportType]) ?? "D";
  return `${prefix}-${id}`;
}

export interface DecisionRow {
  id: number;
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

/**
 * Mirrors log_decision_record (lines 92-139) — returns the new row's id, or null if Supabase isn't configured.
 *
 * Uses the log_decision_record() SECURITY DEFINER RPC instead of a direct
 * .insert().select("id") call, because anon has no SELECT grant on
 * nixara_decisions. A plain .insert().select() would be rolled back when the
 * subsequent SELECT fails RLS, leaving the table empty.  The RPC runs as the
 * table owner, does the INSERT internally, and returns the new id — anon only
 * needs EXECUTE on the function.
 */
export async function logDecisionRecord(params: LogDecisionParams): Promise<number | null> {
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
  if (error || data === null || data === undefined) return null;
  return data as number;
}

export interface LogOutcomeParams {
  decisionId: number | null;
  sessionId: string;
  metricName: string;
  metricBefore: number | null;
  metricAfter: number | null;
  metricUnit: string;
  outcomeRating: OutcomeRating;
  notes?: string;
}

/** Mirrors log_outcome (lines 162-187) — fire-and-forget. */
export async function logOutcome(params: LogOutcomeParams): Promise<void> {
  if (!supabase) return;
  await supabase.from("nixara_outcomes").insert({
    decision_id: params.decisionId,
    session_id: params.sessionId,
    metric_name: params.metricName,
    metric_before: params.metricBefore,
    metric_after: params.metricAfter,
    metric_unit: params.metricUnit,
    outcome_rating: params.outcomeRating,
    outcome_notes: params.notes ?? "",
  });
}

/**
 * Mirrors fetch_decision_by_id (lines 190-210), but via the get_decision_by_id
 * RPC rather than a direct table SELECT — anon has no SELECT grant on
 * nixara_decisions (see migration note), only EXECUTE on this function.
 *
 * Note: supabase.rpc() always returns an array, even for single-row results.
 * We unwrap the first element and return null if the array is empty (not found).
 */
export async function fetchDecisionById(id: number): Promise<DecisionRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_decision_by_id", { p_id: id });
  if (error || !data) return null;
  // RPC returns an array — unwrap the first row (null if not found)
  const row = Array.isArray(data) ? (data[0] ?? null) : data;
  return row as DecisionRow | null;
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
 * get_outcome_for_decision SECURITY DEFINER RPC (anon has no SELECT on
 * nixara_outcomes directly).  Returns null if none exists yet.
 */
export async function fetchOutcomeForDecision(decisionId: number): Promise<OutcomeRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_outcome_for_decision", { p_decision_id: decisionId });
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
