import { supabase } from "./supabase";
import type { ReportType } from "./report";

export interface DriftGreetingInfo {
  reportType: ReportType | null;
  metricName: string | null;
  matchedColumn: string | null;
  priorValue: number | null;
  currentValue: number | null;
  pctChange: number | null;
  decisionQuestion: string | null;
  decisionPublicId: string | null;
}

export interface GreetingContext {
  previousLastSeenAt: Date | null;
  pendingCount: number;
  drift: DriftGreetingInfo | null;
}

const EMPTY_CONTEXT: GreetingContext = { previousLastSeenAt: null, pendingCount: 0, drift: null };

/**
 * One round trip: records this check-in and returns everything the greeting
 * needs (see checkin_and_get_greeting, nixara_supabase_setup.sql section
 * 19c) -- the previous last_seen_at, the pending-decision count across every
 * session this visitor has ever logged, and the single most recent
 * not-yet-surfaced drift event, if any. Called as soon as the dashboard
 * mounts, independent of any dataset upload -- see Greeting.tsx for why that
 * sequencing matters.
 */
export async function checkinAndGetGreeting(visitorId: string): Promise<GreetingContext> {
  if (!supabase || !visitorId) return EMPTY_CONTEXT;
  const { data, error } = await supabase.rpc("checkin_and_get_greeting", { p_visitor_id: visitorId });
  if (error || !data) return EMPTY_CONTEXT;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return EMPTY_CONTEXT;

  const hasDrift = row.drift_report_type !== null && row.drift_report_type !== undefined;

  return {
    previousLastSeenAt: row.previous_last_seen_at ? new Date(row.previous_last_seen_at as string) : null,
    pendingCount: Number(row.pending_count ?? 0),
    drift: hasDrift
      ? {
          reportType: (row.drift_report_type as ReportType) ?? null,
          metricName: (row.drift_metric_name as string) ?? null,
          matchedColumn: (row.drift_matched_column as string) ?? null,
          priorValue: row.drift_prior_value !== null ? Number(row.drift_prior_value) : null,
          currentValue: row.drift_current_value !== null ? Number(row.drift_current_value) : null,
          pctChange: row.drift_pct_change !== null ? Number(row.drift_pct_change) : null,
          decisionQuestion: (row.drift_decision_question as string) ?? null,
          decisionPublicId: (row.drift_decision_public_id as string) ?? null,
        }
      : null,
  };
}

export interface LogDriftEventParams {
  visitorId: string;
  reportType: ReportType;
  metricName: string;
  matchedColumn: string;
  priorValue: number;
  currentValue: number;
  pctChange: number;
  decisionQuestion: string;
  decisionPublicId: string | null;
}

/**
 * Persists one drift finding past the tab it was found in (see
 * log_drift_event) -- called once per flag, from the same upload-time
 * detectDrift() call that already builds the on-screen DriftBanner, so a
 * LATER visit's greeting can still say "something shifted" even though this
 * architecture has no background jobs to notice it any other way.
 */
export async function logDriftEvent(params: LogDriftEventParams): Promise<void> {
  if (!supabase || !params.visitorId) return;
  await supabase.rpc("log_drift_event", {
    p_visitor_id: params.visitorId,
    p_report_type: params.reportType,
    p_metric_name: params.metricName,
    p_matched_column: params.matchedColumn,
    p_prior_value: params.priorValue,
    p_current_value: params.currentValue,
    p_pct_change: params.pctChange,
    p_decision_question: params.decisionQuestion,
    p_decision_public_id: params.decisionPublicId,
  });
}

// ── Pure greeting-text logic -- no I/O, easy to reason about in isolation ──

export type TimeOfDay = "morning" | "afternoon" | "evening" | "late-night";

export function timeOfDay(now: Date): TimeOfDay {
  const h = now.getHours();
  if (h >= 23 || h < 5) return "late-night";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export interface GreetingSegment {
  text: string;
  bold?: boolean;
}

export interface Greeting {
  /** Small uppercase label above the line -- mirrors the source mockup's trigger tag. */
  trigger: string;
  segments: GreetingSegment[];
  href: string | null;
  /** Whether to use the emphasized "highlight" card style (zero-pending / drift). */
  highlight: boolean;
}

/**
 * Picks one of six variants. Time-of-day sets the base tone; what Nixara
 * already knows (pending count, whether anything changed since the last
 * visit, whether Drift fired) picks the actual line. Nothing here is
 * randomized for novelty -- every variant is true for the exact moment
 * someone opens the app, using only data checkinAndGetGreeting() fetched.
 */
export function buildGreeting(now: Date, ctx: GreetingContext): Greeting {
  const tod = timeOfDay(now);
  const salutation: Record<TimeOfDay, string> = {
    morning: "Good morning.",
    afternoon: "Good afternoon.",
    evening: "Good evening.",
    "late-night": "Still here?",
  };
  const plural = ctx.pendingCount === 1 ? "decision" : "decisions";
  const verb = ctx.pendingCount === 1 ? "is" : "are";

  // Drift outranks everything else -- it's the most actionable signal Nixara has.
  if (ctx.drift) {
    return {
      trigger: "Decision Drift detected overnight",
      segments: [
        { text: `${salutation[tod]} ` },
        { text: "Something shifted", bold: true },
        { text: " since your last decision — worth a look before anything else." },
      ],
      href: ctx.drift.decisionPublicId
        ? `/memory?highlight=${encodeURIComponent(ctx.drift.decisionPublicId)}`
        : "/memory",
      highlight: true,
    };
  }

  if (tod === "late-night") {
    return {
      trigger: "Late night (after 11pm)",
      segments: [{ text: "Still here? Whatever it is, it'll still be true in the morning." }],
      href: ctx.pendingCount > 0 ? "/inbox" : null,
      highlight: false,
    };
  }

  if (ctx.pendingCount === 0) {
    return {
      trigger: "Zero decisions pending",
      segments: [
        { text: `${salutation[tod]} ` },
        { text: "Clean slate", bold: true },
        { text: " — nothing's waiting on you today. Rare. Enjoy it." },
      ],
      href: null,
      highlight: true,
    };
  }

  if (tod === "evening") {
    return {
      trigger: "Evening",
      segments: [{ text: "Good evening. Decisions don't clock out — but you probably should." }],
      href: "/inbox",
      highlight: false,
    };
  }

  const sameDayAsLastVisit = ctx.previousLastSeenAt !== null && isSameCalendarDay(ctx.previousLastSeenAt, now);

  if (tod === "afternoon" && sameDayAsLastVisit) {
    const earlierLabel = timeOfDay(ctx.previousLastSeenAt!) === "morning" ? "this morning" : "earlier today";
    return {
      trigger: "Afternoon · nothing's changed",
      segments: [
        { text: "Good afternoon. Still the same " },
        { text: `${ctx.pendingCount} ${plural}`, bold: true },
        { text: ` from ${earlierLabel} — they haven't gone anywhere.` },
      ],
      href: "/inbox",
      highlight: false,
    };
  }

  return {
    trigger: tod === "morning" ? "Morning · decisions pending" : "Decisions pending",
    segments: [
      { text: `${salutation[tod]} ` },
      { text: `${ctx.pendingCount} ${plural}`, bold: true },
      { text: ` ${verb} waiting on you.` },
    ],
    href: "/inbox",
    highlight: false,
  };
}
