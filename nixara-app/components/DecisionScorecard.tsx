"use client";

import { PiePanel } from "./Charts";
import type { ScorecardStats } from "@/lib/scorecard";

export default function DecisionScorecard({ stats }: { stats: ScorecardStats }) {
  if (stats.totalDecisions === 0) return null;

  const ratingData = [
    { key: "Exceeded", value: stats.byRating.exceeded },
    { key: "Met", value: stats.byRating.met },
    { key: "Fell Short", value: stats.byRating.missed },
  ].filter((d) => d.value > 0);

  return (
    <div className="mb-8">
      <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-3">Scorecard</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Decisions logged" value={stats.totalDecisions} />
        <StatCard label="Approved" value={stats.byChoice.approved} sub={`${stats.byChoice.rejected} rejected · ${stats.byChoice.postponed} postponed`} />
        <StatCard label="Outcomes scored" value={stats.scoredCount} sub={stats.unscoredApprovedCount > 0 ? `${stats.unscoredApprovedCount} awaiting a result` : "all caught up"} />
        <StatCard
          label="Accuracy"
          value={stats.accuracyPct !== null ? `${stats.accuracyPct}%` : "—"}
          sub={stats.accuracyPct !== null ? "exceeded or met, of scored" : "no outcomes logged yet"}
        />
      </div>

      {ratingData.length > 0 && (
        <div className="max-w-md">
          <PiePanel title="Outcome ratings" data={ratingData} />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-1.5">{label}</p>
      <p className="text-2xl font-semibold text-text">{value}</p>
      {sub && <p className="text-text-mute text-xs mt-1">{sub}</p>}
    </div>
  );
}
