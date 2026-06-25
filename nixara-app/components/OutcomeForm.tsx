"use client";

import { useState } from "react";
import type { OutcomeRating } from "@/lib/decisions";
import type { RecordedOutcome } from "@/lib/session-context";

const UNITS = ["$", "%", "units", "leads", "customers", "€", "£", "other"];
const RATINGS: { value: OutcomeRating; label: string }[] = [
  { value: "exceeded", label: "✅ Exceeded expectations" },
  { value: "met", label: "🎯 Met expectations" },
  { value: "missed", label: "⚠️ Fell short" },
];

interface Props {
  onSubmit: (outcome: RecordedOutcome & { notes?: string }) => Promise<void>;
}

export default function OutcomeForm({ onSubmit }: Props) {
  const [metricName, setMetricName] = useState("");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [unit, setUnit] = useState(UNITS[0]);
  const [rating, setRating] = useState<OutcomeRating>("met");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await onSubmit({
      metricName,
      metricBefore: before ? Number(before) : null,
      metricAfter: after ? Number(after) : null,
      metricUnit: unit,
      outcomeRating: rating,
      notes,
    });
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 mt-3">
      <div>
        <label className="block text-xs font-medium text-text-mute mb-1">Metric tracked</label>
        <input
          type="text"
          value={metricName}
          onChange={(e) => setMetricName(e.target.value)}
          placeholder="e.g. Monthly Revenue"
          required
          className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">Value BEFORE</label>
          <input
            type="number"
            step="0.01"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
            className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">Unit</label>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">Value AFTER</label>
          <input
            type="number"
            step="0.01"
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-mute mb-1">Outcome rating</label>
        <div className="flex gap-4">
          {RATINGS.map((r) => (
            <label key={r.value} className="flex items-center gap-1.5 text-sm text-text">
              <input
                type="radio"
                name="rating"
                checked={rating === r.value}
                onChange={() => setRating(r.value)}
              />
              {r.label}
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-mute mb-1">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
        />
      </div>
      <button
        type="submit"
        disabled={!metricName || submitting}
        className="bg-accent text-white font-semibold text-sm rounded-lg px-4 py-2 hover:bg-accent-dk disabled:opacity-40 transition-colors"
      >
        {submitting ? "Saving…" : "Log Outcome"}
      </button>
    </form>
  );
}
