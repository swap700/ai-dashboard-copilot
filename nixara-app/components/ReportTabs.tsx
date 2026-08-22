"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { REPORT_TYPES, type ReportType } from "@/lib/report";
import { buildVisualSections } from "@/lib/report-visual";
import type { ReportSetupValue } from "./ReportSetup";
import DecisionPanel from "./DecisionPanel";
import ReportVisualBody from "./ReportVisual";

interface Props {
  reports: Record<ReportType, string>;
  context: ReportSetupValue & { datasetName: string };
}

async function downloadExport(
  kind: "docx" | "pdf",
  reportText: string,
  reportType: ReportType,
  ctx: ReportSetupValue
) {
  const res = await fetch(`/api/export/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reportText,
      title: reportType,
      who: ctx.who,
      decision: ctx.decision,
      timeframe: ctx.timeframe,
    }),
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${reportType.toLowerCase().replace(/ /g, "_")}.${kind}`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportTabs({ reports, context }: Props) {
  const [active, setActive] = useState<ReportType>(REPORT_TYPES[0]);

  return (
    <div className="mb-10">
      <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-3">AI Reports</p>

      <div className="flex border-b-2 border-border mb-5">
        {REPORT_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setActive(type)}
            className={`px-5 py-2.5 text-sm font-medium -mb-0.5 border-b-2 transition-colors ${
              active === type
                ? "text-accent border-accent font-semibold"
                : "text-text-dim border-transparent hover:text-accent hover:bg-accent-bg-soft"
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      <motion.div
        key={active}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <ReportVisualBody sections={buildVisualSections(reports[active], active)} />

        <div className="grid grid-cols-2 gap-3 mt-4">
          <button
            type="button"
            onClick={() => downloadExport("docx", reports[active], active, context)}
            className="border border-border rounded-lg py-2 text-sm font-medium text-text-mute hover:border-accent hover:text-accent hover:bg-accent-bg-soft transition-colors"
          >
            ↓ Download as Word
          </button>
          <button
            type="button"
            onClick={() => downloadExport("pdf", reports[active], active, context)}
            className="border border-border rounded-lg py-2 text-sm font-medium text-text-mute hover:border-accent hover:text-accent hover:bg-accent-bg-soft transition-colors"
          >
            ↓ Download as PDF
          </button>
        </div>

        <DecisionPanel
          reportType={active}
          role={context.who}
          datasetName={context.datasetName}
          question={context.decision}
          timeframe={context.timeframe}
          reportText={reports[active]}
        />
      </motion.div>
    </div>
  );
}
