"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { logDecisionRecord, logOutcome, type DecisionChoice, type OutcomeRating } from "./decisions";
import type { ReportType } from "./report";

const SESSION_ID_KEY = "nixara_analytics_session_id";

export interface RecordedDecision {
  choice: DecisionChoice;
  decisionId: number | null;
  role: string;
  datasetName: string;
  question: string;
  timeframe: string;
  // Task 13: linked recommendation + responsible owner
  recommendation?: string;
  owner?: string;
  // Task 14: reason when postponed
  postponeReason?: string;
}

export interface RecordedOutcome {
  metricName: string;
  metricBefore: number | null;
  metricAfter: number | null;
  metricUnit: string;
  outcomeRating: OutcomeRating;
}

interface SessionState {
  sessionId: string;
  decisions: Partial<Record<ReportType, RecordedDecision>>;
  outcomes: Partial<Record<ReportType, RecordedOutcome>>;
  recordDecision: (
    reportType: ReportType,
    choice: DecisionChoice,
    ctx: {
      role: string;
      datasetName: string;
      question: string;
      timeframe: string;
      notes?: string;
      recommendation?: string;
      owner?: string;
      postponeReason?: string;
    }
  ) => Promise<void>;
  recordOutcome: (
    reportType: ReportType,
    outcome: RecordedOutcome & { notes?: string }
  ) => Promise<void>;
  /** Clear all in-memory and sessionStorage decisions + outcomes when new data is loaded. */
  clearDecisions: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

function loadSessionId(): string {
  if (typeof window === "undefined") return "";
  const existing = window.sessionStorage.getItem(SESSION_ID_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_ID_KEY, fresh);
  return fresh;
}

const DECISIONS_KEY = "nixara_session_decisions";
const OUTCOMES_KEY = "nixara_session_outcomes";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState("");
  const [decisions, setDecisions] = useState<Partial<Record<ReportType, RecordedDecision>>>({});
  const [outcomes, setOutcomes] = useState<Partial<Record<ReportType, RecordedOutcome>>>({});

  useEffect(() => {
    setSessionId(loadSessionId());
    const savedDecisions = window.sessionStorage.getItem(DECISIONS_KEY);
    if (savedDecisions) setDecisions(JSON.parse(savedDecisions));
    const savedOutcomes = window.sessionStorage.getItem(OUTCOMES_KEY);
    if (savedOutcomes) setOutcomes(JSON.parse(savedOutcomes));
  }, []);

  const recordDecision: SessionState["recordDecision"] = async (reportType, choice, ctx) => {
    const decisionId = await logDecisionRecord({
      sessionId,
      reportType,
      role: ctx.role,
      datasetName: ctx.datasetName,
      choice,
      notes: ctx.notes,
      timeframe: ctx.timeframe,
      question: ctx.question,
      recommendation: ctx.recommendation,
      owner: ctx.owner,
      postponeReason: ctx.postponeReason,
    });
    const next: typeof decisions = {
      ...decisions,
      [reportType]: {
        choice,
        decisionId,
        role: ctx.role,
        datasetName: ctx.datasetName,
        question: ctx.question,
        timeframe: ctx.timeframe,
        recommendation: ctx.recommendation,
        owner: ctx.owner,
        postponeReason: ctx.postponeReason,
      },
    };
    setDecisions(next);
    window.sessionStorage.setItem(DECISIONS_KEY, JSON.stringify(next));
  };

  const recordOutcome: SessionState["recordOutcome"] = async (reportType, outcome) => {
    const decision = decisions[reportType];
    await logOutcome({
      decisionId: decision?.decisionId ?? null,
      sessionId,
      metricName: outcome.metricName,
      metricBefore: outcome.metricBefore,
      metricAfter: outcome.metricAfter,
      metricUnit: outcome.metricUnit,
      outcomeRating: outcome.outcomeRating,
      notes: outcome.notes,
    });
    const next = { ...outcomes, [reportType]: outcome };
    setOutcomes(next);
    window.sessionStorage.setItem(OUTCOMES_KEY, JSON.stringify(next));
  };

  const clearDecisions = () => {
    setDecisions({});
    setOutcomes({});
    window.sessionStorage.removeItem(DECISIONS_KEY);
    window.sessionStorage.removeItem(OUTCOMES_KEY);
  };

  const value = useMemo(
    () => ({ sessionId, decisions, outcomes, recordDecision, recordOutcome, clearDecisions }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, decisions, outcomes]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
