"use client";

import { useState } from "react";
import { useSession } from "@/lib/session-context";
import type { DecisionChoice } from "@/lib/decisions";
import type { ReportType } from "@/lib/report";

interface Props {
  reportType: ReportType;
  role: string;
  datasetName: string;
  question: string;
  timeframe: string;
}

const BADGE: Record<DecisionChoice, { icon: string; label: string; bg: string; fg: string }> = {
  approved: { icon: "✅", label: "Approved", bg: "bg-success-bg", fg: "text-success" },
  rejected: { icon: "❌", label: "Rejected", bg: "bg-danger-bg", fg: "text-danger" },
  postponed: { icon: "⏸", label: "Postponed", bg: "bg-warn-bg", fg: "text-warn" },
};

export default function DecisionPanel({ reportType, role, datasetName, question, timeframe }: Props) {
  const { decisions, recordDecision } = useSession();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState<DecisionChoice | null>(null);

  const prior = decisions[reportType];

  const handleDecide = async (choice: DecisionChoice) => {
    setSaving(choice);
    await recordDecision(reportType, choice, { role, datasetName, question, timeframe, notes });
    setSaving(null);
  };

  return (
    <div className="bg-accent-bg-soft border border-accent-border rounded-xl px-5 py-4 mt-4">
      <p className="font-semibold text-text text-sm mb-0.5">📋 Record Your Decision</p>
      <p className="text-text-mute text-xs mb-3">What did you decide to do with these recommendations?</p>

      {prior ? (
        <div>
          <span
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${BADGE[prior.choice].bg} ${BADGE[prior.choice].fg}`}
          >
            {BADGE[prior.choice].icon} Decision recorded — {BADGE[prior.choice].label}
            {prior.decisionId && (
              <>
                <span className="opacity-60 font-normal">·</span>
                ID <strong>#{prior.decisionId}</strong>
              </>
            )}
          </span>
          {prior.decisionId && (
            <p className="text-text-dim text-xs mt-2">
              Save Decision ID #{prior.decisionId} — enter it in the Outcomes tab to log what happened after you acted on this.
            </p>
          )}
        </div>
      ) : (
        <div>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add context (optional) — e.g. Assigned to Sarah, revisit end of Q3…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text mb-3 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => handleDecide("approved")}
              className="rounded-lg border border-success-border bg-success-bg text-success font-medium text-sm py-2 hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              {saving === "approved" ? "Saving…" : "✅ Approve"}
            </button>
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => handleDecide("rejected")}
              className="rounded-lg border border-danger-border bg-danger-bg text-danger font-medium text-sm py-2 hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              {saving === "rejected" ? "Saving…" : "❌ Reject"}
            </button>
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => handleDecide("postponed")}
              className="rounded-lg border border-warn-border bg-warn-bg text-warn font-medium text-sm py-2 hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              {saving === "postponed" ? "Saving…" : "⏸ Postpone"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
