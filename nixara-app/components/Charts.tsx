"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Dataset } from "@/lib/data-analysis";
import { aggregateBy, categoricalColumns, numericColumns } from "@/lib/data-analysis";

function BarPanel({ title, data, color }: { title: string; data: { key: string; value: number }[]; color: string }) {
  const height = Math.max(220, data.length * 32);
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <p className="text-text-mute text-xs uppercase tracking-wider font-semibold mb-3">{title}</p>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={{ stroke: "#E2E8F0" }} />
          <YAxis
            type="category"
            dataKey="key"
            width={110}
            tick={{ fontSize: 11, fill: "#1E293B" }}
            axisLine={{ stroke: "#E2E8F0" }}
          />
          <Tooltip
            contentStyle={{ borderRadius: 8, borderColor: "#E2E8F0", fontSize: 12 }}
            cursor={{ fill: "#FBEEE7" }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.value < 0 ? "#DC2626" : color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Charts({ dataset }: { dataset: Dataset }) {
  const cats = categoricalColumns(dataset);
  const nums = numericColumns(dataset);

  if (cats.length === 0 || nums.length === 0) return null;
  const firstCat = cats[0];
  const uniqueCount = new Set(dataset.rows.map((r) => r[firstCat])).size;
  if (uniqueCount > 25) return null;

  const chart1 = aggregateBy(dataset, firstCat, nums[0]);
  const chart2 = nums[1] ? aggregateBy(dataset, firstCat, nums[1]) : null;

  return (
    <div className="grid md:grid-cols-2 gap-4 mb-8">
      <BarPanel title={`${nums[0]} by ${firstCat}`} data={chart1} color="#C2542A" />
      {chart2 && <BarPanel title={`${nums[1]} by ${firstCat}`} data={chart2} color="#D98F5E" />}
    </div>
  );
}
