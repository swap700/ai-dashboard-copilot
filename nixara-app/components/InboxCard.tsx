"use client";

import { useState } from "react";
import { logOutcome, updateDecisionDueDate, formatDecisionId } from "@/lib/decisions";
import type { RecordedOutcome } from "@/lib/session-context";
import type { InboxItem } from "@/lib/inbox";
import OutcomeForm from "./OutcomeForm";

interface Props {
  item: InboxItem;
  sessionId: string;
  onOutcomeLogged: (publicId: string, outcome: RecordedOutcome & { notes?: string }) => void;
  onDueDateChanged: (id: number, newDueDate: string | null) => void;
}

export default function InboxCard({ item, sessionId, onOutcomeLogged, onDueDateChanged }: Props) {
  const [editingDate, setEditingDate] = useState(false);
  const [draftDate, setDraftDate] = useState(item.dueDate ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmitOutcome = async (o: RecordedOutcome & { notes?: string }) => {
    await logOutcome({
      publicId: item.publicId,
      sessionId,
      metricName: o.metricName,
      metricBefore: o.metricBefore,
      metricAfter: o.metricAfter,
      metricUnit: o.metricUnit,
      outcomeRating: o.outcomeRating,
      notes: o.notes,
    });
    onOutcomeLogged(item.publicId, o);
  };

  const handleSaveDate = async () => {
    setSaving(true);
    const ok = await updateDecisionDueDate(item.id, sessionId, draftDate || null);
    setSaving(false);
    if (ok) {
      onDueDateChanged(item.id, draftDate || null);
      setEditingDate(false);
    }
  };

  const dueLabel = item.dueDate ? new Date(item.dueDate + "T00:00:00").toLocaleDateString() : null;

  return (
    <div
      className={`bg-surface border ${
        item.overdue ? "border-danger-border" : "border-border"
      } border-l-4 ${item.overdue ? "border-l-danger" : "border-l-accent"} rounded-xl p-5 mb-4`}
    >
      <div className="flex items-center justify-between mb-1">
        <p className="font-semibold text-text text-sm">
          {item.reportType}{" "}
          <span className="text-text-dim font-normal">· ID {formatDecisionId(item.reportType, item.publicId)}</span>
        </p>
        <div className="flex items-center gap-2">
          {item.owner && (
            <span className="text-xs text-text-mute bg-accent-bg-soft border border-accent-border rounded-md px-2 py-0.5">
              👤 {item.owner}
            </span>
          )}
          {item.overdue ? (
            <span className="text-xs font-semibold text-danger bg-danger-bg border border-danger-border rounded-md px-2 py-0.5">
              ⚠ Overdue{dueLabel ? ` · was due ${dueLabel}` : ""}
            </span>
          ) : dueLabel ? (
            <span className="text-xs font-semibold text-text-mute bg-surface border border-border rounded-md px-2 py-0.5">
              📅 Due {dueLabel}
              {item.daysUntilDue !== null && item.daysUntilDue <= 7 && (
                <span className="text-warn"> · {item.daysUntilDue === 0 ? "today" : `${item.daysUntilDue}d left`}</span>
              )}
            </span>
          ) : (
            <span className="text-xs text-text-dim">No due date</span>
          )}
        </div>
      </div>

      <p className="text-text-mute text-xs mb-2">
        {item.role} · {item.datasetName} · {item.timeframe}
      </p>

      {item.question && <p className="text-text-mute text-xs italic mb-2">&quot;{item.question}&quot;</p>}

      {item.recommendation && item.recommendation !== "All recommendations" && (
        <div className="bg-accent-bg-soft border border-accent-border rounded-lg px-3 py-2 text-xs text-text mb-2">
          <span className="text-text-mute">Applied to: </span>
          {item.recommendation}
        </div>
      )}

      {item.notes && <p className="text-text-dim text-xs mb-2">Notes: {item.notes}</p>}

      {/* Due date editor — set one for the first time, or move an existing one */}
      {editingDate ? (
        <div className="flex items-center gap-2 mb-3">
          <input
            type="date"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            className="rounded-lg border border-border bg-accent-bg-soft px-3 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
          <button
            type="button"
            disabled={saving}
            onClick={handleSaveDate}
            className="text-xs font-semibold text-accent hover:text-accent-dk disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraftDate(item.dueDate ?? "");
              setEditingDate(false);
            }}
            className="text-xs text-text-mute hover:text-text"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditingDate(true)}
          className="text-xs text-accent hover:text-accent-dk font-medium mb-2"
        >
          {item.dueDate ? "✏️ Change due date" : "📅 Set a due date"}
        </button>
      )}

      <details className="mt-2">
        <summary className="text-accent text-sm font-medium cursor-pointer">
          📝 Log outcome for {item.reportType}
        </summary>
        <OutcomeForm onSubmit={handleSubmitOutcome} />
      </details>
    </div>
  );
}
