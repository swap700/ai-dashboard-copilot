"use client";

import OutcomeForm from "./OutcomeForm";
import type { RecordedDecision, RecordedOutcome } from "@/lib/session-context";
import type { DecisionChoice, OutcomeRating } from "@/lib/decisions";
import { formatDecisionId } from "@/lib/decisions";

const BORDER: Record<DecisionChoice, string> = {
  approved:  "border-l-success",
  rejected:  "border-l-danger",
  postponed: "border-l-warn",
};
const LABEL: Record<DecisionChoice, string> = {
  approved:  "✅ Approved",
  rejected:  "❌ Rejected",
  postponed: "⏸ Postponed",
};

// Task 15: Accuracy Score mapping
const ACCURACY: Record<OutcomeRating, { badge: string; bg: string; fg: string }> = {
  exceeded: { badge: "🟢 Exceeded",    bg: "bg-success-bg", fg: "text-success" },
  met:      { badge: "🎯 Met",         bg: "bg-accent-bg-soft", fg: "text-accent" },
  missed:   { badge: "🔴 Fell Short",  bg: "bg-danger-bg",  fg: "text-danger"  },
};

interface Props {
  reportType: string;
  decision: RecordedDecision;
  outcome?: RecordedOutcome;
  onLogOutcome: (outcome: RecordedOutcome & { notes?: string }) => Promise<void>;
}

export default function DecisionCard({ reportType, decision, outcome, onLogOutcome }: Props) {
  const pctChange =
    outcome?.metricBefore && outcome.metricBefore !== 0 && outcome.metricAfter !== null
      ? (((outcome.metricAfter as number) - outcome.metricBefore) / Math.abs(outcome.metricBefore)) * 100
      : null;

  return (
    <div className={`bg-surface border border-border ${BORDER[decision.choice]} border-l-4 rounded-xl p-5 mb-4`}>

      {/* Header row */}
      <div className="flex items-center justify-between mb-1">
        <p className="font-semibold text-text text-sm">
          {reportType}
          {decision.decisionId && (
            <span className="text-text-dim font-normal"> · ID {formatDecisionId(reportType, decision.decisionId)}</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {decision.owner && (
            <span className="text-xs text-text-mute bg-accent-bg-soft border border-accent-border rounded-md px-2 py-0.5">
              👤 {decision.owner}
            </span>
          )}
          <span className="text-xs font-semibold text-text-mute">{LABEL[decision.choice]}</span>
        </div>
      </div>

      <p className="text-text-mute text-xs mb-2">
        {decision.role} · {decision.datasetName} · {decision.timeframe}
      </p>

      {/* Task 13: Show which recommendation was acted on */}
      {decision.recommendation && decision.recommendation !== "All recommendations" && (
        <div className="bg-accent-bg-soft border border-accent-border rounded-lg px-3 py-2 text-xs text-text mb-2">
          <span className="text-text-mute">Applied to: </span>{decision.recommendation}
        </div>
      )}

      {/* Task 14: Show postpone reason if applicable */}
      {decision.choice === "postponed" && decision.postponeReason && (
        <div className="text-xs text-warn bg-warn-bg border border-warn-border rounded-lg px-3 py-1.5 mb-2 inline-block">
          ⏸ {decision.postponeReason}
        </div>
      )}

      {/* Outcome section */}
      {outcome ? (
        <div className="mt-2 space-y-2">
          {/* Metric row */}
          <div className="bg-success-bg border border-success-border rounded-lg px-4 py-3 text-sm text-text">
            <strong>{outcome.metricName}</strong>:{" "}
            {outcome.metricBefore ?? "—"} → {outcome.metricAfter ?? "—"} {outcome.metricUnit}
            {pctChange !== null && (
              <span className="text-success font-medium">
                {" "}({pctChange > 0 ? "+" : ""}{pctChange.toFixed(1)}%)
              </span>
            )}
          </div>
          {/* Task 15: Accuracy Score badge */}
          <div className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${ACCURACY[outcome.outcomeRating].bg} ${ACCURACY[outcome.outcomeRating].fg}`}>
            Accuracy: {ACCURACY[outcome.outcomeRating].badge}
          </div>
        </div>
      ) : (
        <details className="mt-2">
          <summary className="text-accent text-sm font-medium cursor-pointer">
            📝 Log outcome for {reportType}
          </summary>
          <OutcomeForm onSubmit={onLogOutcome} />
        </details>
      )}
    </div>
  );
}
