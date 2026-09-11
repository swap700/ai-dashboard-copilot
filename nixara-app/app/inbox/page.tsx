"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { useNixaraStore } from "@/lib/store";
import { fetchDecisionsForVisitor, type DecisionWithOutcome } from "@/lib/decisions";
import type { RecordedOutcome } from "@/lib/session-context";
import { buildInbox } from "@/lib/inbox";
import InboxCard from "@/components/InboxCard";
import { schemaOverlapRatio, SCHEMA_OVERLAP_THRESHOLD } from "@/lib/data-analysis";

function InboxPageInner() {
  const { visitorId, sessionId } = useSession();
  // Decision Drift: the Inbox lists approved-but-unscored decisions from ANY
  // past session/day (fetchDecisionsForVisitor), so the dataset currently
  // loaded in this tab isn't necessarily the one a given item was recorded
  // against -- unlike the Outcomes page's "This Session" list, which is
  // always in sync (see app/outcomes/page.tsx). Only hand the dataset to an
  // InboxCard when its stored dataset_name matches what's actually loaded
  // right now AND enough of its original columns are still present (see
  // isSameDataset below) -- a filename match alone isn't proof it's the same
  // data (two uploads can share a name and be completely different exports),
  // so auto-fill/slicing never runs against a dataset that merely looks right.
  const { dataset, fileName } = useNixaraStore();

  /**
   * True when `item` is safe to treat as "the currently loaded dataset" for
   * outcome auto-fill / drift-baseline purposes: same filename, AND (when the
   * item has a persisted column list to check against -- older decisions,
   * logged before this existed, won't) the loaded dataset's schema overlaps
   * it by at least SCHEMA_OVERLAP_THRESHOLD. See schemaOverlapRatio's doc
   * comment (lib/data-analysis.ts) for what this does and doesn't catch.
   */
  const isSameDataset = (item: DecisionWithOutcome): boolean => {
    if (!dataset || item.datasetName !== fileName) return false;
    if (!item.datasetColumns || item.datasetColumns.length === 0) return true; // nothing to check against -- fall back to the filename match
    return schemaOverlapRatio(item.datasetColumns, dataset.columns) >= SCHEMA_OVERLAP_THRESHOLD;
  };
  const [rows, setRows] = useState<DecisionWithOutcome[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Deep link from the Greeting card / Drift Banner elsewhere in the app --
  // scrolls to and flashes the matching item instead of leaving the person
  // to find it themselves in a list.
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const highlightedRef = useRef<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!visitorId) return;
    let cancelled = false;
    setLoading(true);
    fetchDecisionsForVisitor(visitorId).then((data) => {
      if (!cancelled) {
        setRows(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visitorId]);

  useEffect(() => {
    if (scrolled || !highlightId || !highlightedRef.current) return;
    highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    setScrolled(true);
  }, [scrolled, highlightId, rows]);

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
                    metric_dimension: outcome.metricDimension ?? null,
                    metric_dimension_value: outcome.metricDimensionValue ?? null,
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
          <div
            key={item.id}
            ref={item.publicId === highlightId ? highlightedRef : undefined}
            className={
              item.publicId === highlightId
                ? "rounded-xl ring-2 ring-accent ring-offset-2 ring-offset-bg transition-shadow"
                : undefined
            }
          >
            <InboxCard
              item={item}
              sessionId={sessionId}
              visitorId={visitorId}
              onOutcomeLogged={handleOutcomeLogged}
              onDueDateChanged={handleDueDateChanged}
              dataset={isSameDataset(item) ? (dataset ?? undefined) : undefined}
            />
          </div>
        ))}
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageInner />
    </Suspense>
  );
}
