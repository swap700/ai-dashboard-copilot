"use client";

import OutcomeForm from "./OutcomeForm";
import type { RecordedDecision, RecordedOutcome } from "@/lib/session-context";
import type { DecisionChoice } from "@/lib/decisions";

const BORDER: Record<DecisionChoice, string> = {
  approved: "border-l-success",
  rejected: "border-l-danger",
  postponed: "border-l-warn",
};
const LABEL: Record<DecisionChoice, string> = {
  approved: "✅ Approved",
  rejected: "❌ Rejected",
  postponed: "⏸ Postponed",
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
      <div className="flex items-center justify-between mb-2">
        <p className="font-semibold text-text text-sm">
          {reportType}
          {decision.decisionId && <span className="text-text-dim font-normal"> · ID #{decision.decisionId}</span>}
        </p>
        <span className="text-xs font-semibold text-text-mute">{LABEL[decision.choice]}</span>
      </div>
      <p className="text-text-mute text-xs mb-3">
        {decision.role} · {decision.datasetName} · {decision.timeframe}
      </p>

      {outcome ? (
        <div className="bg-success-bg border border-success-border rounded-lg px-4 py-3 text-sm text-text">
          <strong>{outcome.metricName}</strong>: {outcome.metricBefore ?? "—"} → {outcome.metricAfter ?? "—"} {outcome.metricUnit}
          {pctChange !== null && (
            <span className="text-success font-medium"> ({pctChange > 0 ? "+" : ""}{pctChange.toFixed(1)}%)</span>
          )}
        </div>
      ) : (
        <details>
          <summary className="text-accent text-sm font-medium cursor-pointer">📝 Log outcome for {reportType}</summary>
          <OutcomeForm onSubmit={onLogOutcome} />
        </details>
      )}
    </div>
  );
}
