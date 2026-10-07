"use client";

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
import type { AggregatedPoint, Dataset, ChartSpec } from "@/lib/data-analysis";
import { pickChartSpecs } from "@/lib/data-analysis";
import { formatNumber } from "@/lib/format";

const PALETTE = ["#C2542A", "#D98F5E", "#E8B88A", "#8B3A1F", "#A8632F", "#F2D4B8"];
const tooltipStyle = { borderRadius: 8, borderColor: "#E2E8F0", fontSize: 12 };

function tickFmt(value: unknown): string {
  return typeof value === "number" ? formatNumber(value) : String(value ?? "");
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
}: {
  active?: boolean;
  payload?: { payload: AggregatedPoint; name?: string }[];
  label?: unknown;
  agg: "mean" | "sum";
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
      <p className="text-text text-xs font-semibold m-0">{heading}</p>
      <p className="text-accent text-xs font-bold m-0 mt-0.5">
        {agg === "sum" ? "Total" : "Average"} {formatNumber(point.value)}
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
}: {
  title: string;
  note?: string | null;
  /** Series name shown in the tooltip -- see ChartSpec.metricLabel (data-analysis.ts). */
  metricLabel: string;
  agg: "mean" | "sum";
  data: AggregatedPoint[];
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
            tickFormatter={tickFmt}
          />
          <YAxis
            type="category"
            dataKey="key"
            width={110}
            tick={{ fontSize: 11, fill: "#1E293B" }}
            axisLine={{ stroke: "#E2E8F0" }}
          />
          <Tooltip cursor={{ fill: "#FBEEE7" }} content={<CoverageTooltip agg={agg} />} />
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

export function PiePanel({ title, note, agg, data }: { title: string; note?: string | null; agg: "mean" | "sum"; data: AggregatedPoint[] }) {
  return (
    <ChartFrame title={title} note={note}>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="key" cx="50%" cy="50%" outerRadius={85} label={(e) => String(e.name ?? "")}>
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip content={<CoverageTooltip agg={agg} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
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
}: {
  title: string;
  note?: string | null;
  metricLabel: string;
  agg: "mean" | "sum";
  data: { key: string; value: number }[];
}) {
  return (
    <ChartFrame title={title} note={note}>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
          <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
          <XAxis dataKey="key" tick={{ fontSize: 10, fill: "#64748B" }} axisLine={{ stroke: "#E2E8F0" }} />
          <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={{ stroke: "#E2E8F0" }} tickFormatter={tickFmt} />
          <Tooltip content={<CoverageTooltip agg={agg} />} />
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
function TreemapTooltip({ active, payload }: { active?: boolean; payload?: { payload: { name: string; size: number } }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const node = payload[0].payload;
  return (
    <div
      style={{ ...tooltipStyle, background: "#fff" }}
      className="border px-2.5 py-1.5 text-xs text-text"
    >
      {node.name} : {formatNumber(node.size)}
    </div>
  );
}

function TreemapPanel({ title, note, data }: { title: string; note?: string | null; data: AggregatedPoint[] }) {
  const treeData = data.map((d) => ({ name: d.key, size: Math.abs(d.value) }));
  return (
    <ChartFrame title={title} note={note}>
      <ResponsiveContainer width="100%" height={260}>
        <Treemap data={treeData} dataKey="size" nameKey="name" stroke="#fff" fill="#C2542A">
          <Tooltip content={<TreemapTooltip />} />
        </Treemap>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function ChartPanel({ spec }: { spec: ChartSpec }) {
  const note = coverageNote(spec.coverage);
  switch (spec.type) {
    case "pie":
      return <PiePanel title={spec.title} note={note} agg={spec.agg} data={spec.data} />;
    case "area":
      return <AreaPanel title={spec.title} note={note} metricLabel={spec.metricLabel} agg={spec.agg} data={spec.data} />;
    case "treemap":
      return <TreemapPanel title={spec.title} note={note} data={spec.data} />;
    default:
      return <BarPanel title={spec.title} note={note} metricLabel={spec.metricLabel} agg={spec.agg} data={spec.data} />;
  }
}

export default function Charts({ dataset, decisionText = "" }: { dataset: Dataset; decisionText?: string }) {
  const specs = pickChartSpecs(dataset, decisionText, 2);
  if (specs.length === 0) return null;

  return (
    <div className="grid md:grid-cols-2 gap-4 mb-8">
      {specs.map((spec, i) => (
        <ChartPanel key={`${spec.type}-${spec.title}-${i}`} spec={spec} />
      ))}
    </div>
  );
}
