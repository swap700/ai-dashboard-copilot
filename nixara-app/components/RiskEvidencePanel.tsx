"use client";

/**
 * The Risk Report's visual half: every figure in it computed by Nixara, none
 * of it written by the model.
 *
 * WHY THIS EXISTS. The Risk Report used to carry a 3x3 likelihood-by-impact
 * matrix. It was the most convincing thing on the page and the least
 * supported: both of its axes were words a model invented, because nothing in
 * a single uploaded file says how likely a future event is. Deleting it was
 * right and left the report as a wall of prose, which reads as thinner than
 * it is - a reader who sees only text assumes only text was done.
 *
 * So the visual weight comes back, from arithmetic instead. Four stat tiles,
 * a concentration curve, an integrity bar and a direction sparkline, all from
 * collectRiskEvidenceFor(). Nothing here can be wrong in the way the matrix
 * was wrong: if a figure is not computable from the file, its tile does not
 * render.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import type { Dataset } from "@/lib/data-analysis";
import { collectRiskEvidenceFor, humanizeColumnName } from "@/lib/data-analysis";
import type { Concentration } from "@/lib/risk-evidence";
import { formatNumber } from "@/lib/format";
import Tooltip from "@/components/Tooltip";

interface Props {
  dataset: Dataset;
  /** What the user asked, so the panel measures the metric the report is about. */
  question: string;
  /**
   * "full" draws the curves; "compact" is tiles and the integrity bar only.
   *
   * The panel started on the Risk Report alone, which made the other two
   * tabs look thinner by comparison the moment it shipped - the opposite of
   * the problem it was built to solve. Every tab now carries the figures;
   * only the Risk Report carries the charts, because that is the tab whose
   * whole subject is where the exposure sits.
   */
  variant?: "full" | "compact";
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}bn`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return formatNumber(n);
}

function Info({ text }: { text: string }) {
  return (
    <Tooltip content={text}>
      <span className="ml-1 cursor-help text-text-dim text-[0.72rem]" aria-hidden>
        &#9432;
      </span>
    </Tooltip>
  );
}

function Tile({
  label,
  value,
  sub,
  tone = "plain",
  info,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "plain" | "warn" | "danger" | "good";
  info?: string;
}) {
  const ring =
    tone === "danger"
      ? "border-danger-border bg-danger-bg"
      : tone === "warn"
        ? "border-warn-border bg-warn-bg"
        : tone === "good"
          ? "border-success-border bg-success-bg"
          : "border-border bg-surface";
  const ink =
    tone === "danger"
      ? "text-danger"
      : tone === "warn"
        ? "text-warn"
        : tone === "good"
          ? "text-success"
          : "text-text";
  return (
    <div className={`rounded-xl border px-4 py-3 ${ring}`}>
      <p className="text-text-mute text-[0.66rem] font-bold uppercase tracking-wider mb-1">
        {label}
        {info && <Info text={info} />}
      </p>
      <p className={`text-[1.5rem] leading-none font-bold mb-1 ${ink}`}>{value}</p>
      <p className="text-text-mute text-[0.72rem] leading-snug">{sub}</p>
    </div>
  );
}

/**
 * The cumulative curve, biggest group first. An even split plots as a
 * straight diagonal and concentration bows above it, so the gap between the
 * two lines IS the finding - there is nothing to interpret.
 */
function ConcentrationCurve({ c, metric }: { c: Concentration; metric: string }) {
  const L = 44;
  const R = 536;
  const T = 10;
  const B = 150;

  const points = useMemo(() => {
    const n = c.cumulative.length;
    const xs = c.cumulative.map((p, i) => ({
      x: L + ((i + 1) / n) * (R - L),
      y: B - p.cumulativeShare * (B - T),
      key: p.key,
      cum: p.cumulativeShare,
      rank: p.rank,
    }));
    return [{ x: L, y: B, key: "", cum: 0, rank: 0 }, ...xs];
  }, [c]);

  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} ${R},${T} ${L},${B}`;

  const fifthX = L + (c.topFifthCount / c.levels) * (R - L);
  const fifthY = B - c.topFifthShare * (B - T);
  const fifthEvenY = B - (c.topFifthCount / c.levels) * (B - T);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <p className="text-text-mute text-[0.66rem] font-bold uppercase tracking-wider">
          Where {humanizeColumnName(metric)} sits
          <Info text="Groups sorted biggest first. The dashed line is what a perfectly even split would look like. The further the solid line sits above it, the more of the total a few groups carry." />
        </p>
        <p className="text-text-mute text-[0.7rem]">by {humanizeColumnName(c.column)}</p>
      </div>
      <svg viewBox="0 0 548 176" className="w-full h-auto" role="img"
           aria-label={`Cumulative share of ${metric} by ${c.column}. The top ${c.topFifthCount} of ${c.levels} carry ${pct(c.topFifthShare)}, against ${pct(c.topFifthCount / c.levels)} for an even split.`}>
        <line x1={L} y1={B} x2={R} y2={B} stroke="var(--border)" strokeWidth="1" />
        <line x1={L} y1={(B + T) / 2} x2={R} y2={(B + T) / 2} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" />
        <line x1={L} y1={T} x2={R} y2={T} stroke="var(--border)" strokeWidth="1" />
        <line x1={L} y1={T} x2={L} y2={B} stroke="var(--border)" strokeWidth="1" />

        <polygon points={area} fill="var(--accent)" fillOpacity="0.10" />
        <line x1={L} y1={B} x2={R} y2={T} stroke="var(--text-dim)" strokeWidth="1.75" strokeDasharray="5 4" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        <line x1={fifthX} y1={fifthY} x2={fifthX} y2={fifthEvenY} stroke="var(--text)" strokeWidth="1" strokeDasharray="2 3" />
        <circle cx={fifthX} cy={fifthY} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.75" />
        <circle cx={fifthX} cy={fifthEvenY} r="3" fill="var(--text-dim)" stroke="var(--surface)" strokeWidth="1.75" />

        <text x="38" y={B + 4} fontSize="9.5" fill="var(--text-dim)" textAnchor="end">0</text>
        <text x="38" y={T + 4} fontSize="9.5" fill="var(--text-dim)" textAnchor="end">100%</text>
        <text x={L} y={B + 15} fontSize="9.5" fill="var(--text-dim)" textAnchor="start">biggest</text>
        <text x={R} y={B + 15} fontSize="9.5" fill="var(--text-dim)" textAnchor="end">all {c.levels}</text>
        <text x={Math.min(fifthX + 8, R - 150)} y={Math.max(fifthY - 6, 16)} fontSize="11" fontWeight="700" fill="var(--text)">
          {pct(c.topFifthShare)} in the top {c.topFifthCount}
        </text>
        <text x={Math.min(fifthX + 8, R - 150)} y={Math.min(fifthEvenY + 14, B - 4)} fontSize="10" fill="var(--text-mute)">
          {pct(c.topFifthCount / c.levels)} if spread evenly
        </text>
      </svg>
      <div className="flex items-center gap-4 flex-wrap mt-1">
        <span className="inline-flex items-center gap-1.5 text-[0.7rem] text-text-mute">
          <svg width="18" height="6" aria-hidden="true"><line x1="1" y1="3" x2="17" y2="3" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" /></svg>
          Your {humanizeColumnName(metric).toLowerCase()}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[0.7rem] text-text-mute">
          <svg width="18" height="6" aria-hidden="true"><line x1="1" y1="3" x2="17" y2="3" stroke="var(--text-dim)" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" /></svg>
          Spread evenly
        </span>
      </div>
    </div>
  );
}

/** Total split into the part that is double counted, the part that is negative, and the rest. */
function IntegrityBar({
  total,
  duplicateValue,
  negativeValue,
  metric,
}: {
  total: number;
  duplicateValue: number;
  negativeValue: number;
  metric: string;
}) {
  if (total <= 0) return null;
  const dup = Math.max(0, Math.min(1, duplicateValue / total));
  const neg = Math.max(0, Math.min(1, Math.abs(negativeValue) / total));
  const clean = Math.max(0, 1 - dup - neg);
  // A sliver still has to be visible, or a 0.9% finding reads as nothing.
  const w = (x: number) => (x === 0 ? 0 : Math.max(x * 100, 1.5));

  return (
    <div>
      <p className="text-text-mute text-[0.66rem] font-bold uppercase tracking-wider mb-1.5">
        What is inside the total
        <Info text="Every total in this report includes the duplicated rows. The slivers are drawn at a minimum width so a small share stays visible." />
      </p>
      <div className="flex h-3 w-full gap-[2px] rounded-full overflow-hidden" role="img"
           aria-label={`Of total ${metric}, ${pct(dup)} sits on duplicate rows and ${pct(neg)} on negative amounts.`}>
        <div style={{ width: `${w(clean)}%` }} className="bg-success rounded-l-full" />
        {dup > 0 && <div style={{ width: `${w(dup)}%` }} className="bg-danger" />}
        {neg > 0 && <div style={{ width: `${w(neg)}%` }} className="bg-warn rounded-r-full" />}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
        <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-text-mute">
          <span className="w-2 h-2 rounded-full bg-success" aria-hidden /> Clean {pct(clean)}
        </span>
        {dup > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-text-mute">
            <span className="w-2 h-2 rounded-full bg-danger" aria-hidden /> Double counted {pct(dup)}
          </span>
        )}
        {neg > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-text-mute">
            <span className="w-2 h-2 rounded-full bg-warn" aria-hidden /> Negative {pct(neg)}
          </span>
        )}
      </div>
    </div>
  );
}

export default function RiskEvidencePanel({ dataset, question, variant = "full" }: Props) {
  const evidence = useMemo(() => collectRiskEvidenceFor(dataset, question), [dataset, question]);
  if (!evidence) return null;

  const metricLabel = humanizeColumnName(evidence.metric);
  const concentrated = evidence.concentration.filter((c) => c.concentrated);
  // Up to four curves, most lopsided first. One curve answered "is THIS
  // column concentrated" and left the reader to wonder about the other seven;
  // four answers "is anything here concentrated", which is the question. The
  // list is already sorted by how far the top share sits above an even split.
  const curves = (concentrated.length > 0 ? concentrated : evidence.concentration).slice(0, 4);
  const curveFor = curves[0] ?? null;
  const integrity = evidence.integrity;
  const direction = evidence.direction;
  const showCharts = variant === "full";

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="bg-surface border border-border rounded-xl px-5 py-4 mb-6"
      aria-label="Risk evidence"
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <p className="text-accent text-[0.68rem] font-bold uppercase tracking-wider">
          What the file itself shows
        </p>
        <p className="text-text-dim text-[0.7rem]">
          Calculated by Nixara &#183; {dataset.rows.length.toLocaleString()} rows
        </p>
      </div>

      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {integrity && (
          <Tile
            label={`Total ${metricLabel}`}
            value={compact(integrity.total)}
            sub={`across ${dataset.rows.length.toLocaleString()} rows`}
            info="The sum Nixara computed. Every share on this page is a share of it."
          />
        )}
        {curveFor && (
          <Tile
            label="Largest single share"
            value={pct(curveFor.topShare)}
            sub={`${curveFor.topLevel}, of ${curveFor.levels} ${humanizeColumnName(curveFor.column).toLowerCase()} values`}
            tone={curveFor.concentrated ? "danger" : "good"}
            info={
              curveFor.concentrated
                ? "A few groups carry a disproportionate share, so losing or repricing one of them moves the total."
                : "No group carries a disproportionate share, so there is no single group worth targeting."
            }
          />
        )}
        {integrity && integrity.duplicateRows > 0 && (
          <Tile
            label="Counted twice"
            value={compact(integrity.duplicateValue)}
            sub={`${integrity.duplicateRows.toLocaleString()} exact repeat rows, ${pct(integrity.duplicateValue / integrity.total)} of the total`}
            tone="danger"
            info="Rows identical across every column. The metric on every repeat beyond the first is included in each total in this report."
          />
        )}
        {integrity && integrity.negativeRows > 0 && (
          <Tile
            label="Negative amounts"
            value={compact(integrity.negativeValue)}
            sub={`${integrity.negativeRows.toLocaleString()} rows below zero`}
            tone="warn"
            info="Refunds that belong in the figures, or errors that do not. Either way they net against the positives in every total."
          />
        )}
        {direction && (
          <Tile
            label="Direction"
            value={`${direction.change >= 0 ? "+" : ""}${(direction.change * 100).toFixed(1)}%`}
            sub={`${direction.firstPeriod} to ${direction.lastPeriod}, ${direction.periods} periods`}
            tone={direction.trend === "flat" ? "plain" : direction.change > 0 ? "warn" : "good"}
            info="First complete period against the last. An unfinished final period is excluded rather than compared against full ones."
          />
        )}
      </div>

      {showCharts && curves.length > 0 && (
        <div
          className="grid gap-5 mb-5"
          style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${curves.length > 2 ? 260 : 300}px, 1fr))` }}
        >
          {curves.map((c) => (
            <ConcentrationCurve key={c.column} c={c} metric={evidence.metric} />
          ))}
        </div>
      )}

      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        {integrity && (
          <div className="flex flex-col gap-4">
            <IntegrityBar
              total={integrity.total}
              duplicateValue={integrity.duplicateValue}
              negativeValue={integrity.negativeValue}
              metric={evidence.metric}
            />
            {direction?.lastPeriodPartial && (
              <p className="text-warn text-[0.78rem] leading-snug bg-warn-bg border border-warn-border rounded-lg px-3 py-2">
                {direction.lastPeriod} holds {direction.lastPeriodRows.toLocaleString()} rows against a
                typical {direction.typicalPeriodRows.toLocaleString()}, so it is still being filled. It is
                left out of the direction figure above. Do not read the drop at the end as a fall.
              </p>
            )}
            {!direction && (
              <p className="text-text-mute text-[0.78rem] leading-snug">
                This file has no usable dates, so nothing here shows whether anything is getting better or
                worse. Any claim about a trend in the text below is not from your data.
              </p>
            )}
          </div>
        )}
      </div>

      {curveFor && !curveFor.concentrated && evidence.concentration.every((c) => !c.concentrated) && (
        <p className="text-text-mute text-[0.8rem] leading-relaxed mt-4 pt-3 border-t border-border">
          <b className="text-text">
            Nothing in this file is concentrated enough to target
          </b>
          , across all {evidence.concentration.length} groupable columns. The widest of them is{" "}
          {humanizeColumnName(curveFor.column).toLowerCase()}, where the top {curveFor.topFifthCount} of{" "}
          {curveFor.levels}{" "}
          {humanizeColumnName(curveFor.column).toLowerCase()} values carry {pct(curveFor.topFifthShare)},
          against {pct(curveFor.topFifthCount / curveFor.levels)} if the total were spread evenly. Picking
          a leader from a list this flat would be reading noise.
        </p>
      )}
    </motion.section>
  );
}
