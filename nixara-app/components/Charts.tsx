"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import type { AggregatedPoint, Dataset, ChartSpec, UnmeasuredColumn } from "@/lib/data-analysis";
import { MIN_METRIC_COVERAGE, chartableColumns, describeUnmeasuredColumns, pickChartSpecs } from "@/lib/data-analysis";
import { formatNumber } from "@/lib/format";

const PALETTE = ["#C2542A", "#D98F5E", "#E8B88A", "#8B3A1F", "#A8632F", "#F2D4B8"];
const tooltipStyle = { borderRadius: 8, borderColor: "#E2E8F0", fontSize: 12 };

function tickFmt(value: unknown): string {
  return typeof value === "number" ? formatNumber(value) : String(value ?? "");
}

/**
 * Category names on the axis, cut to fit.
 *
 * Recharts wraps a long category tick onto several lines, and on coaster_db
 * that produced overlapping text: "In Production closed for maintenance as
 * of july 30 no reopening date known" printed on top of "Under construction".
 * The full name is still in the tooltip, which is where a reader looks when
 * a bar matters to them.
 */
const MAX_TICK_CHARS = 24;
function categoryTick(value: unknown): string {
  const text = String(value ?? "");
  return text.length > MAX_TICK_CHARS ? `${text.slice(0, MAX_TICK_CHARS - 1).trimEnd()}\u2026` : text;
}

/**
 * Tooltip that names the operation and says how much of the group it used.
 *
 * Added 2026-10. The old tooltip read "Operating : 1,979.85" with no hint that
 * the figure was an average, nor that it came from 104 of 668 rows. Both facts
 * now travel on the datum (see AggregatedPoint in data-analysis.ts), so the
 * reader can see a thin figure for what it is.
 */
function CoverageTooltip({
  active,
  payload,
  label,
  agg,
  unit,
}: {
  active?: boolean;
  payload?: { payload: AggregatedPoint; name?: string }[];
  label?: unknown;
  agg: "mean" | "sum";
  /** Put back the unit that number-format.ts stripped at parse time. */
  unit?: string | null;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const thin = point.total > 0 && point.used < point.total;
  const heading = String(label ?? point.key ?? "");

  return (
    <div
      className={`rounded-md border px-3 py-2 shadow-sm ${
        thin ? "border-warn-border bg-warn-bg" : "border-border bg-surface"
      }`}
    >
      <p className="text-text text-xs font-semibold m-0 max-w-[260px] break-words">{heading}</p>
      <p className="text-accent text-xs font-bold m-0 mt-0.5">
        {agg === "sum" ? "Total" : "Average"} {formatNumber(point.value)}
        {unit ? ` ${unit}` : ""}
      </p>
      {point.total > 0 && (
        <p className={`text-[0.68rem] m-0 mt-1 ${thin ? "text-warn font-semibold" : "text-text-mute"}`}>
          {thin
            ? `Based on ${point.used.toLocaleString("en-US")} of ${point.total.toLocaleString("en-US")} rows. The other ${(point.total - point.used).toLocaleString("en-US")} are not numbers.`
            : `Based on all ${point.total.toLocaleString("en-US")} rows.`}
        </p>
      )}
    </div>
  );
}

function ChartFrame({
  title,
  note,
  children,
}: {
  title: string;
  note?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <p className="text-text-mute text-xs uppercase tracking-wider font-semibold mb-1">{title}</p>
      {note && <p className="text-warn text-[0.7rem] font-medium mb-2">{note}</p>}
      <div className={note ? "" : "mt-2"}>{children}</div>
    </div>
  );
}

/** A one-line warning under the title when the chart as a whole is thin. */
function coverageNote(coverage: { used: number; total: number }): string | null {
  if (coverage.total === 0 || coverage.used >= coverage.total) return null;
  const pct = Math.round((coverage.used / coverage.total) * 100);
  return `Built from ${coverage.used.toLocaleString("en-US")} of ${coverage.total.toLocaleString("en-US")} rows (${pct}%). The rest hold no usable number.`;
}

export function BarPanel({
  title,
  note,
  metricLabel,
  agg,
  data,
  unit = null,
}: {
  title: string;
  note?: string | null;
  /** Series name shown in the tooltip -- see ChartSpec.metricLabel (data-analysis.ts). */
  metricLabel: string;
  agg: "mean" | "sum";
  data: AggregatedPoint[];
  unit?: string | null;
}) {
  const height = Math.max(220, data.length * 32);
  return (
    <ChartFrame title={title} note={note}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "#64748B" }}
            axisLine={{ stroke: "#E2E8F0" }}
            tickFormatter={(v) => (unit ? `${tickFmt(v)} ${unit}` : tickFmt(v))}
          />
          <YAxis
            type="category"
            dataKey="key"
            width={150}
            interval={0}
            tick={{ fontSize: 11, fill: "#1E293B" }}
            tickFormatter={categoryTick}
            axisLine={{ stroke: "#E2E8F0" }}
          />
          <Tooltip cursor={{ fill: "#FBEEE7" }} content={<CoverageTooltip agg={agg} unit={unit} />} />
          <Bar dataKey="value" name={metricLabel} radius={[0, 4, 4, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.value < 0 ? "#DC2626" : "#C2542A"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function PiePanel({ title, note, agg, data, unit = null }: { title: string; note?: string | null; agg: "mean" | "sum"; data: AggregatedPoint[]; unit?: string | null }) {
  return (
    <ChartFrame title={title} note={note}>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="key" cx="50%" cy="50%" outerRadius={85} label={(e) => categoryTick(e.name)}>
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip content={<CoverageTooltip agg={agg} unit={unit} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => categoryTick(v)} />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function AreaPanel({
  title,
  note,
  metricLabel,
  agg,
  data,
  unit = null,
}: {
  title: string;
  note?: string | null;
  metricLabel: string;
  agg: "mean" | "sum";
  data: { key: string; value: number }[];
  unit?: string | null;
}) {
  return (
    <ChartFrame title={title} note={note}>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
          <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
          <XAxis dataKey="key" tick={{ fontSize: 10, fill: "#64748B" }} axisLine={{ stroke: "#E2E8F0" }} />
          <YAxis
            tick={{ fontSize: 11, fill: "#64748B" }}
            axisLine={{ stroke: "#E2E8F0" }}
            tickFormatter={(v) => (unit ? `${tickFmt(v)} ${unit}` : tickFmt(v))}
          />
          <Tooltip content={<CoverageTooltip agg={agg} unit={unit} />} />
          <Area type="monotone" dataKey="value" name={metricLabel} stroke="#C2542A" fill="#F2D4B8" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * BUG FIX (2026-09): the plain `<Tooltip formatter={tooltipFmt} />` used by
 * every other chart relies on Recharts resolving a name/value pairing for
 * the hovered item on its own -- reliable for Bar/Area/Pie, but Treemap's
 * hover handling is its own code path (each rectangle tracks mouseenter
 * independently as the squarify layout is computed), and reports of a
 * tooltip naming a DIFFERENT cell than the one under the cursor point at
 * that pairing, not at which cell Recharts considers "active" being wrong.
 * This sidesteps it entirely: it reads name/size straight off
 * `payload[0].payload`, the exact data object Recharts attaches to whichever
 * rectangle is currently active, instead of trusting a derived label.
 */
function TreemapTooltip({ active, payload, unit = null }: { active?: boolean; payload?: { payload: { name: string; size: number } }[]; unit?: string | null }) {
  if (!active || !payload || payload.length === 0) return null;
  const node = payload[0].payload;
  return (
    <div
      style={{ ...tooltipStyle, background: "#fff" }}
      className="border px-2.5 py-1.5 text-xs text-text max-w-[260px] break-words"
    >
      {node.name} : {formatNumber(node.size)}{unit ? ` ${unit}` : ""}
    </div>
  );
}

function TreemapPanel({ title, note, data, unit = null }: { title: string; note?: string | null; data: AggregatedPoint[]; unit?: string | null }) {
  const treeData = data.map((d) => ({ name: d.key, size: Math.abs(d.value) }));
  return (
    <ChartFrame title={title} note={note}>
      <ResponsiveContainer width="100%" height={260}>
        <Treemap data={treeData} dataKey="size" nameKey="name" stroke="#fff" fill="#C2542A">
          <Tooltip content={<TreemapTooltip unit={unit} />} />
        </Treemap>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function ChartPanel({ spec }: { spec: ChartSpec }) {
  // Two kinds of note can apply at once: the chart is built from part of the
  // file (coverage), and the chart had to collapse categories or use a
  // different column than the question named (spec.note). Both matter, so
  // both are shown rather than one quietly winning.
  const note = [coverageNote(spec.coverage), spec.note].filter(Boolean).join(" ") || null;
  switch (spec.type) {
    case "pie":
      return <PiePanel title={spec.title} note={note} agg={spec.agg} data={spec.data} unit={spec.unit} />;
    case "area":
      return <AreaPanel title={spec.title} note={note} metricLabel={spec.metricLabel} agg={spec.agg} data={spec.data} unit={spec.unit} />;
    case "treemap":
      return <TreemapPanel title={spec.title} note={note} data={spec.data} unit={spec.unit} />;
    default:
      return <BarPanel title={spec.title} note={note} metricLabel={spec.metricLabel} agg={spec.agg} data={spec.data} unit={spec.unit} />;
  }
}

/**
 * What the user sees when no column qualifies for a chart.
 *
 * Added 2026-10 alongside the 80% coverage rule. Before this, a file whose
 * numeric columns were all too thin or all positions rather than amounts
 * rendered nothing at all: no charts, no explanation, and the obvious reading
 * is that the upload failed. The rule is a deliberate refusal, so it has to be
 * stated out loud at the point where the charts would have been.
 */
function NoChartsPanel({ dataset }: { dataset: Dataset }) {
  const unmeasured: UnmeasuredColumn[] = describeUnmeasuredColumns(dataset);
  const threshold = Math.round(MIN_METRIC_COVERAGE * 100);

  return (
    <div className="bg-surface border border-border rounded-xl p-5 mb-8">
      <p className="text-text-mute text-xs uppercase tracking-wider font-semibold mb-2">
        No chart for this file
      </p>
      <p className="text-text text-sm font-semibold m-0">
        Nixara found no column it could total or average safely.
      </p>
      <p className="text-text-mute text-xs leading-relaxed mt-2 mb-0">
        A column has to be at least {threshold}% numbers before Nixara will chart it. Dates,
        calendar years and coordinates are positions rather than amounts, so they are never
        charted even when complete. Your file loaded correctly; there is simply nothing here
        that a bar or a pie would describe honestly.
      </p>

      {unmeasured.length > 0 && (
        <div className="mt-4">
          <p className="text-text text-xs font-semibold mb-2">Columns Nixara looked at and set aside</p>
          <div className="grid gap-1.5">
            {unmeasured.slice(0, 6).map((u) => (
              <div
                key={u.column}
                className="bg-bg rounded-lg px-3 py-2 flex items-baseline justify-between gap-3 flex-wrap"
              >
                <span className="text-text text-xs font-semibold">{u.column}</span>
                <span className="text-text-mute text-xs text-right">{u.detail}</span>
              </div>
            ))}
          </div>
          {unmeasured.length > 6 && (
            <p className="text-text-dim text-[0.7rem] mt-2 mb-0">
              and {unmeasured.length - 6} more, listed in full under Data Quality Risks once you
              generate the report.
            </p>
          )}
        </div>
      )}

      <p className="text-text-mute text-xs leading-relaxed mt-4 mb-0">
        The written report still runs. It will describe the categories, counts and gaps in your
        file instead of charting amounts that are not there.
      </p>
    </div>
  );
}

export default function Charts({ dataset, decisionText = "" }: { dataset: Dataset; decisionText?: string }) {
  const specs = pickChartSpecs(dataset, decisionText, 2);
  if (specs.length === 0) {
    if (dataset.rows.length === 0) return null;
    return <NoChartsPanel dataset={dataset} />;
  }

  return (
    <>
      <div className="grid md:grid-cols-2 gap-4 mb-3">
        {specs.map((spec, i) => (
          <ChartPanel key={`${spec.type}-${spec.title}-${i}`} spec={spec} />
        ))}
      </div>
      <BreakdownHint dataset={dataset} />
    </>
  );
}

/**
 * The columns you can ask a chart to break down by, and how big each is.
 *
 * Answers a question a user asked directly: typing "Location" gave a chart of
 * Status, and nothing on the screen said which column names would work or
 * why that one did not. Every label column is chartable now, so this is not
 * a list of what is permitted -- it is a list of what exists, with the size
 * of each, so the reader can see that Location has 280 values and will be
 * shown as the largest few plus Other.
 */
function BreakdownHint({ dataset }: { dataset: Dataset }) {
  const [open, setOpen] = useState(false);
  const columns = chartableColumns(dataset);
  if (columns.length === 0) return null;
  const shown = open ? columns : columns.slice(0, 6);

  return (
    <div className="mb-8 text-xs text-text-mute">
      <span className="mr-1">Name any of these in your question to chart it:</span>
      {shown.map((c, i) => (
        <span key={c.column}>
          <span className="text-text font-semibold">{c.column}</span>
          <span className="text-text-dim"> ({c.distinct.toLocaleString()}{c.collapses ? ", top 14 + Other" : ""})</span>
          {i < shown.length - 1 ? <span className="text-text-dim">{" · "}</span> : null}
        </span>
      ))}
      {columns.length > 6 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-2 font-semibold text-accent-dk hover:underline"
        >
          {open ? "show fewer" : `+${columns.length - 6} more`}
        </button>
      )}
    </div>
  );
}
