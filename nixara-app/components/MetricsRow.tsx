"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { DashboardScoreBreakdown } from "@/lib/data-analysis";

interface Metric {
  label: string;
  value: number;
}

function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

/**
 * Headline tone for the quality score, independent of *why* it landed where
 * it did — the reasons (if any) are listed separately below.
 */
function scoreHeadline(score: number): string {
  if (score === 100) return "Nothing knocked this down";
  if (score >= 80) return "Good enough for decision support";
  if (score >= 60) return "Usable, with a few caveats";
  return "Worth a closer look before deciding";
}

/**
 * The upload-screen quality card. Deliberately stripped down from an earlier
 * draft that also carried a ring gauge and a "Detected" column: the ring
 * duplicated the plain "Quality score" tile already in the row above, and
 * "Detected" (rows/columns/numeric fields) duplicates the other three tiles
 * in that same row. The one thing genuinely missing from the tiles — *why*
 * the score isn't 100 — is the only thing this card adds.
 *
 * This is the moment before a free-tier customer has spent one of their 3
 * reports: "Quality score: 87" next to "Rows: 18,421" gives no way to judge
 * whether 87 is fine or a reason to clean the file first. This answers that
 * in the same breath the tiles show the number, using the exact breakdown
 * dashboardScoreBreakdown() already computes — nothing here is re-derived.
 */
function QualityCard({ breakdown }: { breakdown: DashboardScoreBreakdown }) {
  const { score, reasons } = breakdown;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
      className="bg-surface border border-border rounded-xl px-5 py-4 mb-8"
    >
      <p className="text-text text-[1.05rem] font-semibold mb-1">{scoreHeadline(score)}</p>
      {reasons.length === 0 ? (
        <p className="text-text-mute text-[0.85rem] leading-relaxed">
          No issues detected across missing data, column count, or row count.
        </p>
      ) : (
        <div className="pt-3 mt-1 border-t border-border">
          <p className="text-text-mute text-[0.72rem] font-bold uppercase tracking-wider mb-2">Why it&apos;s not 100</p>
          <div className="space-y-1.5">
            {reasons.map((reason) => (
              <p key={reason.key} className="text-text text-[0.9rem] leading-relaxed flex gap-2">
                <span className="text-warn shrink-0">{"⚠"}</span>
                <span>{reason.message}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default function MetricsRow({
  metrics,
  qualityBreakdown,
}: {
  metrics: Metric[];
  /** Powers the card below the tiles — omit to render the tiles only. */
  qualityBreakdown?: DashboardScoreBreakdown;
}) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {metrics.map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: i * 0.05, ease: "easeOut" }}
            whileHover={{ y: -3 }}
            className="bg-surface border border-border border-t-[3px] border-t-accent rounded-xl px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
          >
            <p className="text-text-dim text-[0.72rem] uppercase tracking-[0.08em] font-semibold mb-1">
              {m.label}
            </p>
            <p className="text-text text-[1.75rem] font-semibold tracking-tight">
              <CountUp value={m.value} />
            </p>
          </motion.div>
        ))}
      </div>
      {qualityBreakdown && <QualityCard breakdown={qualityBreakdown} />}
    </>
  );
}
