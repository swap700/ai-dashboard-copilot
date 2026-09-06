"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { fetchDecisionsForSession, type DecisionWithOutcome } from "@/lib/decisions";
import type { RecordedOutcome } from "@/lib/session-context";
import { buildInbox } from "@/lib/inbox";
import InboxCard from "@/components/InboxCard";

export default function InboxPage() {
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
    // Logging an outcome resolves the item — it drops out of the inbox on
    // next render since buildInbox() filters to !outcome.
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

  const handleDueDateChanged = (id: number, newDueDate: string | null) => {
    setRows((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, dueDate: newDueDate } : r)) : prev));
  };

  const inbox = rows ? buildInbox(rows) : [];
  const overdueCount = inbox.filter((i) => i.overdue).length;

  return (
    <div className="pb-12">
      <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-2">Decision Inbox</p>
      <h2 className="text-xl font-semibold text-text mb-1">What&apos;s still open.</h2>
      <p className="text-text-mute text-sm mb-8 max-w-xl">
        Every approved decision that hasn&apos;t had its outcome logged yet, soonest-due first.
        {overdueCount > 0 && (
          <span className="text-danger font-medium">
            {" "}
            {overdueCount} {overdueCount === 1 ? "is" : "are"} overdue.
          </span>
        )}
      </p>

      {loading && <p className="text-text-mute text-sm">Loading…</p>}

      {!loading && inbox.length === 0 && (
        <p className="text-text-mute text-sm">
          Nothing open right now. Approved decisions without a logged outcome will show up here — check back after
          you approve something on the Dashboard tab.
        </p>
      )}

      {!loading &&
        inbox.map((item) => (
          <InboxCard
            key={item.id}
            item={item}
            sessionId={sessionId}
            onOutcomeLogged={handleOutcomeLogged}
            onDueDateChanged={handleDueDateChanged}
          />
        ))}
    </div>
  );
}
