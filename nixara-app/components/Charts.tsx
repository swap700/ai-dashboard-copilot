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
import type { Dataset, ChartSpec } from "@/lib/data-analysis";
import { pickChartSpecs } from "@/lib/data-analysis";
import { formatNumber } from "@/lib/format";

const PALETTE = ["#C2542A", "#D98F5E", "#E8B88A", "#8B3A1F", "#A8632F", "#F2D4B8"];
const tooltipStyle = { borderRadius: 8, borderColor: "#E2E8F0", fontSize: 12 };

/** Loosely-typed to match recharts v3's Formatter<ValueType, NameType> generic. */
function tooltipFmt(value: unknown): string {
  return typeof value === "number" ? formatNumber(value) : String(value ?? "");
}

function tickFmt(value: unknown): string {
  return typeof value === "number" ? formatNumber(value) : String(value ?? "");
}

function ChartFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <p className="text-text-mute text-xs uppercase tracking-wider font-semibold mb-3">{title}</p>
      {children}
    </div>
  );
}

export function BarPanel({ title, data }: { title: string; data: { key: string; value: number }[] }) {
  const height = Math.max(220, data.length * 32);
  return (
    <ChartFrame title={title}>
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
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#FBEEE7" }} formatter={tooltipFmt} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.value < 0 ? "#DC2626" : "#C2542A"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function PiePanel({ title, data }: { title: string; data: { key: string; value: number }[] }) {
  return (
    <ChartFrame title={title}>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="key" cx="50%" cy="50%" outerRadius={85} label={(e) => String(e.name ?? "")}>
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={tooltipFmt} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function AreaPanel({ title, data }: { title: string; data: { key: string; value: number }[] }) {
  return (
    <ChartFrame title={title}>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
          <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
          <XAxis dataKey="key" tick={{ fontSize: 10, fill: "#64748B" }} axisLine={{ stroke: "#E2E8F0" }} />
          <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={{ stroke: "#E2E8F0" }} tickFormatter={tickFmt} />
          <Tooltip contentStyle={tooltipStyle} formatter={tooltipFmt} />
          <Area type="monotone" dataKey="value" stroke="#C2542A" fill="#F2D4B8" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function TreemapPanel({ title, data }: { title: string; data: { key: string; value: number }[] }) {
  const treeData = data.map((d) => ({ name: d.key, size: Math.abs(d.value) }));
  return (
    <ChartFrame title={title}>
      <ResponsiveContainer width="100%" height={260}>
        <Treemap data={treeData} dataKey="size" nameKey="name" stroke="#fff" fill="#C2542A">
          <Tooltip contentStyle={tooltipStyle} formatter={tooltipFmt} />
        </Treemap>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function ChartPanel({ spec }: { spec: ChartSpec }) {
  switch (spec.type) {
    case "pie":
      return <PiePanel title={spec.title} data={spec.data} />;
    case "area":
      return <AreaPanel title={spec.title} data={spec.data} />;
    case "treemap":
      return <TreemapPanel title={spec.title} data={spec.data} />;
    default:
      return <BarPanel title={spec.title} data={spec.data} />;
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
