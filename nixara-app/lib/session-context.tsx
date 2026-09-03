"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { logDecisionRecord, logOutcome, updateDecisionChoice, type DecisionChoice, type OutcomeRating } from "./decisions";
import { logEvent } from "./analytics";
import type { ReportType } from "./report";

const SESSION_ID_KEY = "nixara_analytics_session_id";

export interface RecordedDecision {
  choice: DecisionChoice;
  decisionId: number | null;
  publicId: string | null;
  role: string;
  datasetName: string;
  question: string;
  timeframe: string;
  recommendation?: string;
  owner?: string;
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
  updateDecision: (
    reportType: ReportType,
    newChoice: DecisionChoice,
    postponeReason?: string
  ) => Promise<void>;
  clearDecisions: () => void;
  /** Call this when a file or BI source is loaded — logs file_upload event */
  logFileUpload: (dataSource: "csv" | "excel" | "tableau" | "powerbi", dataRows?: number, dataCols?: number) => void;
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

function getReferrer(): string | null {
  if (typeof window === "undefined") return null;
  return document.referrer || null;
}

const DECISIONS_KEY = "nixara_session_decisions";
const OUTCOMES_KEY  = "nixara_session_outcomes";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId]   = useState("");
  const [decisions, setDecisions]   = useState<Partial<Record<ReportType, RecordedDecision>>>({});
  const [outcomes,  setOutcomes]    = useState<Partial<Record<ReportType, RecordedOutcome>>>({});

  useEffect(() => {
    const id = loadSessionId();
    setSessionId(id);

    // Restore persisted session state
    const savedDecisions = window.sessionStorage.getItem(DECISIONS_KEY);
    if (savedDecisions) setDecisions(JSON.parse(savedDecisions));
    const savedOutcomes = window.sessionStorage.getItem(OUTCOMES_KEY);
    if (savedOutcomes) setOutcomes(JSON.parse(savedOutcomes));

    // Log session_start — only fires once per browser session
    const startedKey = "nixara_session_started";
    if (!window.sessionStorage.getItem(startedKey)) {
      window.sessionStorage.setItem(startedKey, "1");
      logEvent({
        session_id: id,
        event_type: "session_start",
        referrer: getReferrer(),
      });
    }
  }, []);

  const logFileUpload = (
    dataSource: "csv" | "excel" | "tableau" | "powerbi",
    dataRows?: number,
    dataCols?: number
  ) => {
    if (!sessionId) return;
    logEvent({
      session_id: sessionId,
      event_type: "file_upload",
      data_source: dataSource,
      data_rows: dataRows,
      data_cols: dataCols,
      referrer: getReferrer(),
    });
  };

  const recordDecision: SessionState["recordDecision"] = async (reportType, choice, ctx) => {
    const logged = await logDecisionRecord({
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
        decisionId: logged?.id ?? null,
        publicId:   logged?.publicId ?? null,
        role:       ctx.role,
        datasetName: ctx.datasetName,
        question:   ctx.question,
        timeframe:  ctx.timeframe,
        recommendation: ctx.recommendation,
        owner:      ctx.owner,
        postponeReason: ctx.postponeReason,
      },
    };
    setDecisions(next);
    window.sessionStorage.setItem(DECISIONS_KEY, JSON.stringify(next));
  };

  const recordOutcome: SessionState["recordOutcome"] = async (reportType, outcome) => {
    const decision = decisions[reportType];
    await logOutcome({
      decisionId:    decision?.decisionId ?? null,
      sessionId,
      metricName:    outcome.metricName,
      metricBefore:  outcome.metricBefore,
      metricAfter:   outcome.metricAfter,
      metricUnit:    outcome.metricUnit,
      outcomeRating: outcome.outcomeRating,
      notes:         outcome.notes,
    });
    const next = { ...outcomes, [reportType]: outcome };
    setOutcomes(next);
    window.sessionStorage.setItem(OUTCOMES_KEY, JSON.stringify(next));
  };

  const updateDecision: SessionState["updateDecision"] = async (reportType, newChoice, postponeReason) => {
    const decision = decisions[reportType];
    if (!decision) return;
    if (decision.decisionId) {
      await updateDecisionChoice(decision.decisionId, sessionId, newChoice, postponeReason);
    }
    const next: typeof decisions = {
      ...decisions,
      [reportType]: {
        ...decision,
        choice: newChoice,
        postponeReason: newChoice === "postponed" ? postponeReason : undefined,
      },
    };
    setDecisions(next);
    window.sessionStorage.setItem(DECISIONS_KEY, JSON.stringify(next));
  };

  const clearDecisions = () => {
    setDecisions({});
    setOutcomes({});
    window.sessionStorage.removeItem(DECISIONS_KEY);
    window.sessionStorage.removeItem(OUTCOMES_KEY);
  };

  const value = useMemo(
    () => ({ sessionId, decisions, outcomes, recordDecision, recordOutcome, updateDecision, clearDecisions, logFileUpload }),
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