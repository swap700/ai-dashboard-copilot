"use client";

import { useState } from "react";
import { useSession } from "@/lib/session-context";
import { fetchDecisionById, logOutcome, type DecisionRow } from "@/lib/decisions";
import OutcomeForm from "@/components/OutcomeForm";
import DecisionCard from "@/components/DecisionCard";
import { REPORT_TYPES } from "@/lib/report";
import type { RecordedOutcome } from "@/lib/session-context";

export default function OutcomesPage() {
  const { sessionId, decisions, outcomes, recordOutcome } = useSession();
  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<DecisionRow | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupOutcomeLogged, setLookupOutcomeLogged] = useState(false);
  const [searching, setSearching] = useState(false);

  const recordedTypes = REPORT_TYPES.filter((t) => decisions[t]);

  const handleLookup = async () => {
    const id = Number(lookupId);
    if (!id) return;
    setSearching(true);
    setLookupError(null);
    setLookupResult(null);
    setLookupOutcomeLogged(false);
    const row = await fetchDecisionById(id);
    setSearching(false);
    if (!row) {
      setLookupError(
        "Decision not found. Double-check the ID, or ask the admin to enable the lookup function (see get_decision_by_id in the project notes)."
      );
      return;
    }
    setLookupResult(row);
  };

  const handleLookupOutcome = async (outcome: RecordedOutcome & { notes?: string }) => {
    if (!lookupResult) return;
    await logOutcome({
      decisionId: lookupResult.id,
      sessionId,
      metricName: outcome.metricName,
      metricBefore: outcome.metricBefore,
      metricAfter: outcome.metricAfter,
      metricUnit: outcome.metricUnit,
      outcomeRating: outcome.outcomeRating,
      notes: outcome.notes,
    });
    setLookupOutcomeLogged(true);
  };

  return (
    <div className="pb-12">
      <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-2">Track Outcomes</p>
      <h2 className="text-xl font-semibold text-text mb-1">Was Nixara right?</h2>
      <p className="text-text-mute text-sm mb-8 max-w-xl">
        Come back here after implementing a recommendation and log what actually happened. Nixara uses this
        to show whether its analysis was accurate.
      </p>

      {recordedTypes.length > 0 && (
        <div className="mb-10">
          <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-3">This Session</p>
          {recordedTypes.map((type) => (
            <DecisionCard
              key={type}
              reportType={type}
              decision={decisions[type]!}
              outcome={outcomes[type]}
              onLogOutcome={(outcome) => recordOutcome(type, outcome)}
            />
          ))}
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl p-5">
        <p className="font-semibold text-text text-sm mb-1">🔍 Find a decision from a previous session</p>
        <div className="flex gap-2 mb-3">
          <input
            type="number"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="Decision ID, e.g. 2847"
            className="flex-1 rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
          />
          <button
            type="button"
            onClick={handleLookup}
            disabled={!lookupId || searching}
            className="bg-accent text-white font-semibold text-sm rounded-lg px-4 py-2 hover:bg-accent-dk disabled:opacity-40 transition-colors"
          >
            {searching ? "Searching…" : "🔍 Find Decision"}
          </button>
        </div>

        {lookupError && <p className="text-danger text-xs">{lookupError}</p>}

        {lookupResult && (
          <div className="border-t border-border pt-4 mt-2">
            <p className="font-semibold text-text text-sm mb-1">
              {lookupResult.report_type} · ID #{lookupResult.id}
            </p>
            <p className="text-text-mute text-xs mb-3">
              {lookupResult.role} · {lookupResult.dataset_name} · {lookupResult.timeframe}
            </p>
            {lookupResult.question && (
              <p className="text-text text-sm italic mb-3">&quot;{lookupResult.question}&quot;</p>
            )}
            {lookupOutcomeLogged ? (
              <p className="text-success text-sm font-medium">✓ Outcome logged. Thanks!</p>
            ) : (
              <OutcomeForm onSubmit={handleLookupOutcome} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
