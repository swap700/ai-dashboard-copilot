"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { fetchDecisionsForSession, type DecisionWithOutcome } from "@/lib/decisions";
import type { RecordedOutcome } from "@/lib/session-context";
import { computeScorecard } from "@/lib/scorecard";
import DecisionScorecard from "@/components/DecisionScorecard";
import MemoryCard from "@/components/MemoryCard";

export default function MemoryPage() {
  const { sessionId } = useSession();
  const [rows, setRows] = useState<DecisionWithOutcome[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    fetchDecisionsForSession(sessionId).then((data) => {
      if (!cancelled) {
        setRows(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleOutcomeLogged = (publicId: string, outcome: RecordedOutcome & { notes?: string }) => {
    setRows((prev) =>
      prev
        ? prev.map((r) =>
            r.publicId === publicId
              ? {
                  ...r,
                  outcome: {
                    id: 0,
                    metric_name: outcome.metricName,
                    metric_before: outcome.metricBefore,
                    metric_after: outcome.metricAfter,
                    metric_unit: outcome.metricUnit,
                    outcome_rating: outcome.outcomeRating,
                    outcome_notes: outcome.notes ?? "",
                  },
                }
              : r
          )
        : prev
    );
  };

  return (
    <div className="pb-12">
      <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-2">Decision Memory</p>
      <h2 className="text-xl font-semibold text-text mb-1">Every decision this session, in one place.</h2>
      <p className="text-text-mute text-sm mb-8 max-w-xl">
        Nobody has to remember what was decided three months ago — it&apos;s all here: what was recommended, who
        owns it, and whether it worked.
      </p>

      {loading && <p className="text-text-mute text-sm">Loading…</p>}

      {!loading && rows && rows.length === 0 && (
        <p className="text-text-mute text-sm">
          Nothing logged yet this session. Decisions you approve, reject, or postpone on the Dashboard tab will
          show up here.
        </p>
      )}

      {!loading && rows && rows.length > 0 && (
        <>
          <DecisionScorecard stats={computeScorecard(rows)} />
          <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-3">History</p>
          {rows.map((row) => (
            <MemoryCard key={row.id} row={row} sessionId={sessionId} onOutcomeLogged={handleOutcomeLogged} />
          ))}
        </>
      )}
    </div>
  );
}
