"use client";

import { useState } from "react";
import { useSession } from "@/lib/session-context";
import { parseRecommendations } from "@/lib/report";
import type { DecisionChoice } from "@/lib/decisions";
import { formatDecisionId } from "@/lib/decisions";
import type { ReportType } from "@/lib/report";

interface Props {
  reportType: ReportType;
  role: string;
  datasetName: string;
  question: string;
  timeframe: string;
  // Task 13: report text so we can parse numbered recommendations
  reportText: string;
}

const BADGE: Record<DecisionChoice, { icon: string; label: string; bg: string; fg: string }> = {
  approved:  { icon: "✅", label: "Approved",  bg: "bg-success-bg", fg: "text-success" },
  rejected:  { icon: "❌", label: "Rejected",  bg: "bg-danger-bg",  fg: "text-danger"  },
  postponed: { icon: "⏸", label: "Postponed", bg: "bg-warn-bg",    fg: "text-warn"    },
};

// Task 14: Postpone reason options
const POSTPONE_REASONS = [
  "Budget constraint",
  "Need more data",
  "Not a priority now",
] as const;

export default function DecisionPanel({ reportType, role, datasetName, question, timeframe, reportText }: Props) {
  const { decisions, recordDecision, updateDecision } = useSession();

  // Form state
  const [notes, setNotes] = useState("");
  const [owner, setOwner] = useState("");
  const [selectedRec, setSelectedRec] = useState<string | null>(null);
  const [recError, setRecError] = useState(false);

  // Task 14: two-step postpone
  const [pendingPostpone, setPendingPostpone] = useState(false);
  const [postponeReason, setPostponeReason] = useState<typeof POSTPONE_REASONS[number]>(POSTPONE_REASONS[0]);

  const [saving, setSaving] = useState<DecisionChoice | null>(null);

  // Edit mode for already-recorded decisions
  const [editing, setEditing] = useState(false);
  const [editPostpone, setEditPostpone] = useState(false);
  const [editPostponeReason, setEditPostponeReason] = useState<typeof POSTPONE_REASONS[number]>(POSTPONE_REASONS[0]);

  const prior = decisions[reportType];

  // Parse numbered recommendations out of the report text
  const recs = parseRecommendations(reportText);

  // Guard: if recommendations are shown, user must pick one before deciding
  const requireRec = (): boolean => {
    if (recs.length > 0 && selectedRec === null) {
      setRecError(true);
      return false;
    }
    setRecError(false);
    return true;
  };

  const handleDecide = async (choice: DecisionChoice, overridePostponeReason?: string) => {
    setSaving(choice);
    await recordDecision(reportType, choice, {
      role,
      datasetName,
      question,
      timeframe,
      notes,
      owner: owner.trim() || undefined,
      recommendation: selectedRec ?? undefined,
      postponeReason: overridePostponeReason,
    });
    setSaving(null);
    setPendingPostpone(false);
  };

  if (prior) {
    const badge = BADGE[prior.choice];

    // ── Edit-postpone reason picker ──────────────────────────────────────────
    if (editPostpone) {
      return (
        <div className="bg-warn-bg border border-warn-border rounded-xl px-5 py-4 mt-4">
          <p className="font-semibold text-text text-sm mb-0.5">⏸ Why are you postponing?</p>
          <p className="text-text-mute text-xs mb-3">Pick the closest reason.</p>
          <div className="space-y-2 mb-4">
            {POSTPONE_REASONS.map((reason) => (
              <label key={reason} className="flex items-center gap-2.5 text-sm text-text cursor-pointer">
                <input
                  type="radio"
                  name="edit_postpone_reason"
                  checked={editPostponeReason === reason}
                  onChange={() => setEditPostponeReason(reason)}
                  className="accent-accent"
                />
                {reason}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving !== null}
              onClick={async () => {
                setSaving("postponed");
                await updateDecision(reportType, "postponed", editPostponeReason);
                setSaving(null);
                setEditing(false);
                setEditPostpone(false);
              }}
              className="flex-1 rounded-lg border border-warn-border bg-warn-bg text-warn font-semibold text-sm py-2 hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              {saving === "postponed" ? "Saving…" : "⏸ Confirm Postpone"}
            </button>
            <button
              type="button"
              onClick={() => setEditPostpone(false)}
              className="px-3 rounded-lg border border-border text-text-mute text-sm hover:bg-surface transition-colors"
            >
              Back
            </button>
          </div>
        </div>
      );
    }

    // ── Inline edit picker ───────────────────────────────────────────────────
    if (editing) {
      return (
        <div className="bg-accent-bg-soft border border-accent-border rounded-xl px-5 py-4 mt-4">
          <p className="font-semibold text-text text-sm mb-0.5">✏️ Change your decision</p>
          <p className="text-text-mute text-xs mb-4">
            Currently: <span className="font-medium">{badge.icon} {badge.label}</span>
            {prior.publicId && <span> · ID {formatDecisionId(reportType, prior.publicId)}</span>}
          </p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <button
              type="button"
              disabled={saving !== null}
              onClick={async () => {
                setSaving("approved");
                await updateDecision(reportType, "approved");
                setSaving(null);
                setEditing(false);
              }}
              className="rounded-lg border border-success-border bg-success-bg text-success font-medium text-sm py-2 hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              {saving === "approved" ? "Saving…" : "✅ Approve"}
            </button>
            <button
              type="button"
              disabled={saving !== null}
              onClick={async () => {
                setSaving("rejected");
                await updateDecision(reportType, "rejected");
                setSaving(null);
                setEditing(false);
              }}
              className="rounded-lg border border-danger-border bg-danger-bg text-danger font-medium text-sm py-2 hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              {saving === "rejected" ? "Saving…" : "❌ Reject"}
            </button>
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => setEditPostpone(true)}
              className="rounded-lg border border-warn-border bg-warn-bg text-warn font-medium text-sm py-2 hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              ⏸ Postpone
            </button>
          </div>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-text-mute text-xs hover:text-text transition-colors"
          >
            ← Cancel
          </button>
        </div>
      );
    }

    // ── Confirmed state (default) ────────────────────────────────────────────
    return (
      <div className="bg-accent-bg-soft border border-accent-border rounded-xl px-5 py-4 mt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="font-semibold text-text text-sm">📋 Decision Recorded</p>
          {prior.publicId && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-accent hover:text-accent-dk font-medium transition-colors"
            >
              ✏️ Edit
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <span className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${badge.bg} ${badge.fg}`}>
            {badge.icon} {badge.label}
            {prior.publicId && (
              <>
                <span className="opacity-60 font-normal">·</span>
                ID <strong>{formatDecisionId(reportType, prior.publicId)}</strong>
              </>
            )}
          </span>
          {prior.owner && (
            <span className="text-xs text-text-mute bg-surface border border-border rounded-md px-2.5 py-1">
              👤 {prior.owner}
            </span>
          )}
          {prior.postponeReason && (
            <span className="text-xs text-warn bg-warn-bg border border-warn-border rounded-md px-2.5 py-1">
              {prior.postponeReason}
            </span>
          )}
        </div>
        {prior.recommendation && prior.recommendation !== "All recommendations" && (
          <p className="text-text-mute text-xs mb-1.5">
            Applied to: <span className="text-text">{prior.recommendation}</span>
          </p>
        )}
        {prior.publicId && (
          <p className="text-text-dim text-xs">
            Save Decision ID {formatDecisionId(reportType, prior.publicId)} — enter it in the Outcomes tab to log what happened.
          </p>
        )}
      </div>
    );
  }

  // ── Postpone "Why?" step ─────────────────────────────────────────────────
  if (pendingPostpone) {
    return (
      <div className="bg-warn-bg border border-warn-border rounded-xl px-5 py-4 mt-4">
        <p className="font-semibold text-text text-sm mb-0.5">⏸ Why are you postponing?</p>
        <p className="text-text-mute text-xs mb-3">Pick the closest reason — helps track patterns over time.</p>
        <div className="space-y-2 mb-4">
          {POSTPONE_REASONS.map((reason) => (
            <label key={reason} className="flex items-center gap-2.5 text-sm text-text cursor-pointer">
              <input
                type="radio"
                name="postpone_reason"
                checked={postponeReason === reason}
                onChange={() => setPostponeReason(reason)}
                className="accent-accent"
              />
              {reason}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving !== null}
            onClick={() => handleDecide("postponed", postponeReason)}
            className="flex-1 rounded-lg border border-warn-border bg-warn-bg text-warn font-semibold text-sm py-2 hover:opacity-80 disabled:opacity-40 transition-opacity"
          >
            {saving === "postponed" ? "Saving…" : "⏸ Confirm Postpone"}
          </button>
          <button
            type="button"
            onClick={() => setPendingPostpone(false)}
            className="px-3 rounded-lg border border-border text-text-mute text-sm hover:bg-surface transition-colors"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // ── Main decision form ───────────────────────────────────────────────────
  return (
    <div className="bg-accent-bg-soft border border-accent-border rounded-xl px-5 py-4 mt-4">
      <p className="font-semibold text-text text-sm mb-0.5">📋 Record Your Decision</p>
      <p className="text-text-mute text-xs mb-4">What did you decide to do with these recommendations?</p>

      {/* Recommendation selector — required before deciding */}
      {recs.length > 0 && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-text-mute mb-1.5">
            Which recommendation does this apply to?{" "}
            <span className="text-danger">*</span>
          </label>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
              <input
                type="radio"
                name={`rec_${reportType}`}
                checked={selectedRec === "All recommendations"}
                onChange={() => { setSelectedRec("All recommendations"); setRecError(false); }}
                className="accent-accent"
              />
              All recommendations
            </label>
            {recs.map((rec) => (
              <label key={rec} className="flex items-start gap-2 text-sm text-text cursor-pointer">
                <input
                  type="radio"
                  name={`rec_${reportType}`}
                  checked={selectedRec === rec}
                  onChange={() => { setSelectedRec(rec); setRecError(false); }}
                  className="accent-accent mt-0.5 shrink-0"
                />
                <span className="leading-snug">{rec}</span>
              </label>
            ))}
          </div>
          {recError && (
            <p className="text-danger text-xs mt-1.5">
              Select which recommendation this decision applies to before proceeding.
            </p>
          )}
        </div>
      )}

      {/* Task 13: Owner field */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-text-mute mb-1">
          Who is responsible for this action? <span className="opacity-60">(optional)</span>
        </label>
        <input
          type="text"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="e.g. Sarah Chen, CFO team, Operations dept…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
        />
      </div>

      {/* Notes */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-text-mute mb-1">
          Notes <span className="opacity-60">(optional)</span>
        </label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Revisit end of Q3, pending budget approval…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => { if (requireRec()) handleDecide("approved"); }}
          className="rounded-lg border border-success-border bg-success-bg text-success font-medium text-sm py-2 hover:opacity-80 disabled:opacity-40 transition-opacity"
        >
          {saving === "approved" ? "Saving…" : "✅ Approve"}
        </button>
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => { if (requireRec()) handleDecide("rejected"); }}
          className="rounded-lg border border-danger-border bg-danger-bg text-danger font-medium text-sm py-2 hover:opacity-80 disabled:opacity-40 transition-opacity"
        >
          {saving === "rejected" ? "Saving…" : "❌ Reject"}
        </button>
        {/* Postpone opens "Why?" step — also guarded by requireRec */}
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => { if (requireRec()) setPendingPostpone(true); }}
          className="rounded-lg border border-warn-border bg-warn-bg text-warn font-medium text-sm py-2 hover:opacity-80 disabled:opacity-40 transition-opacity"
        >
          ⏸ Postpone
        </button>
      </div>
    </div>
  );
}
