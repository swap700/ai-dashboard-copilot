"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { fetchDecisionsForVisitor, type DecisionWithOutcome } from "@/lib/decisions";
import { computeScorecard } from "@/lib/scorecard";
import DecisionScorecard from "@/components/DecisionScorecard";
import MemoryCard from "@/components/MemoryCard";

function MemoryPageInner() {
  const { visitorId } = useSession();
  const [rows, setRows] = useState<DecisionWithOutcome[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Deep link from the Greeting card / Drift Banner elsewhere in the app --
  // scrolls to and flashes the matching decision instead of leaving the
  // person to find it themselves in a list.
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

  return (
    <div className="pb-12">
      <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-2">Decision Memory</p>
      <h2 className="text-xl font-semibold text-text mb-1">Every decision from this browser, in one place.</h2>
      <p className="text-text-mute text-sm mb-8 max-w-xl">
        Nobody has to remember what was decided three months ago — it&apos;s all here: what was recommended, who
        owns it, and whether it worked.
      </p>

      {loading && <p className="text-text-mute text-sm">Loading…</p>}

      {!loading && rows && rows.length === 0 && (
        <p className="text-text-mute text-sm">
          Nothing logged yet from this browser. Decisions you approve, reject, or postpone on the Dashboard tab will
          show up here.
        </p>
      )}

      {!loading && rows && rows.length > 0 && (
        <>
          <DecisionScorecard stats={computeScorecard(rows)} />
          <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-3">History</p>
          {rows.map((row) => (
            <div
              key={row.id}
              ref={row.publicId === highlightId ? highlightedRef : undefined}
              className={
                row.publicId === highlightId
                  ? "rounded-xl ring-2 ring-accent ring-offset-2 ring-offset-bg transition-shadow"
                  : undefined
              }
            >
              <MemoryCard row={row} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function MemoryPage() {
  return (
    <Suspense fallback={null}>
      <MemoryPageInner />
    </Suspense>
  );
}
