"use client";

import { logOutcome, formatDecisionId, type DecisionWithOutcome } from "@/lib/decisions";
import type { RecordedOutcome } from "@/lib/session-context";
import OutcomeForm from "./OutcomeForm";

const BORDER: Record<string, string> = {
  approved: "border-l-success",
  rejected: "border-l-danger",
  postponed: "border-l-warn",
};
const LABEL: Record<string, string> = {
  approved: "✅ Approved",
  rejected: "❌ Rejected",
  postponed: "⏸ Postponed",
};
const ACCURACY: Record<string, { badge: string; bg: string; fg: string }> = {
  exceeded: { badge: "🟢 Exceeded", bg: "bg-success-bg", fg: "text-success" },
  met: { badge: "🎯 Met", bg: "bg-accent-bg-soft", fg: "text-accent" },
  missed: { badge: "🔴 Fell Short", bg: "bg-danger-bg", fg: "text-danger" },
};

interface Props {
  row: DecisionWithOutcome;
  sessionId: string;
  onOutcomeLogged: (publicId: string, outcome: RecordedOutcome & { notes?: string }) => void;
}

export default function MemoryCard({ row, sessionId, onOutcomeLogged }: Props) {
  const choice = row.decision ?? "approved";
  const outcome = row.outcome;
  const pctChange =
    outcome?.metric_before && outcome.metric_before !== 0 && outcome.metric_after !== null
      ? ((outcome.metric_after - outcome.metric_before) / Math.abs(outcome.metric_before)) * 100
      : null;

  const handleSubmit = async (o: RecordedOutcome & { notes?: string }) => {
    await logOutcome({
      publicId: row.publicId,
      sessionId,
      metricName: o.metricName,
      metricBefore: o.metricBefore,
      metricAfter: o.metricAfter,
      metricUnit: o.metricUnit,
      outcomeRating: o.outcomeRating,
      notes: o.notes,
    });
    onOutcomeLogged(row.publicId, o);
  };

  return (
    <div className={`bg-surface border border-border ${BORDER[choice]} border-l-4 rounded-xl p-5 mb-4`}>
      <div className="flex items-center justify-between mb-1">
        <p className="font-semibold text-text text-sm">
          {row.reportType} <span className="text-text-dim font-normal">· ID {formatDecisionId(row.reportType, row.publicId)}</span>
        </p>
        <div className="flex items-center gap-2">
          <span className="text-text-dim text-xs">{new Date(row.createdAt).toLocaleDateString()}</span>
          {row.owner && (
            <span className="text-xs text-text-mute bg-accent-bg-soft border border-accent-border rounded-md px-2 py-0.5">
              👤 {row.owner}
            </span>
          )}
          <span className="text-xs font-semibold text-text-mute">{LABEL[choice]}</span>
        </div>
      </div>

      <p className="text-text-mute text-xs mb-2">
        {row.role} · {row.datasetName} · {row.timeframe}
      </p>

      {row.question && <p className="text-text-mute text-xs italic mb-2">&quot;{row.question}&quot;</p>}

      {row.recommendation && row.recommendation !== "All recommendations" && (
        <div className="bg-accent-bg-soft border border-accent-border rounded-lg px-3 py-2 text-xs text-text mb-2">
          <span className="text-text-mute">Applied to: </span>
          {row.recommendation}
        </div>
      )}

      {choice === "postponed" && row.postponeReason && (
        <div className="text-xs text-warn bg-warn-bg border border-warn-border rounded-lg px-3 py-1.5 mb-2 inline-block">
          ⏸ {row.postponeReason}
        </div>
      )}

      {row.notes && <p className="text-text-dim text-xs mb-2">Notes: {row.notes}</p>}

      {/* H6: outcome tracking gated to approved decisions only — mirrors DecisionCard.tsx. */}
      {choice !== "approved" ? (
        <p className="text-text-dim text-xs mt-2 italic">
          {choice === "rejected"
            ? "Rejected — nothing was implemented, so there's no outcome to track."
            : "Postponed — outcome tracking becomes available once this is approved."}
        </p>
      ) : outcome ? (
        <div className="mt-2 space-y-2">
          <div className="bg-success-bg border border-success-border rounded-lg px-4 py-3 text-sm text-text">
            <strong>{outcome.metric_name}</strong>: {outcome.metric_before ?? "—"} → {outcome.metric_after ?? "—"}{" "}
            {outcome.metric_unit}
            {pctChange !== null && (
              <span className="text-success font-medium">
                {" "}
                ({pctChange > 0 ? "+" : ""}
                {pctChange.toFixed(1)}%)
              </span>
            )}
          </div>
          {ACCURACY[outcome.outcome_rating] && (
            <div
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${ACCURACY[outcome.outcome_rating].bg} ${ACCURACY[outcome.outcome_rating].fg}`}
            >
              Accuracy: {ACCURACY[outcome.outcome_rating].badge}
            </div>
          )}
          {outcome.outcome_notes && <p className="text-text-mute text-xs">{outcome.outcome_notes}</p>}
        </div>
      ) : (
        <details className="mt-2">
          <summary className="text-accent text-sm font-medium cursor-pointer">
            📝 Log outcome for {row.reportType}
          </summary>
          <OutcomeForm onSubmit={handleSubmit} />
        </details>
      )}
    </div>
  );
}
