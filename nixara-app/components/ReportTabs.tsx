"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { REPORT_TYPES, parseReportLines, type ReportType } from "@/lib/report";
import type { ReportSetupValue } from "./ReportSetup";
import DecisionPanel from "./DecisionPanel";

interface Props {
  reports: Record<ReportType, string>;
  context: ReportSetupValue & { datasetName: string };
}

function ReportBody({ text }: { text: string }) {
  const lines = parseReportLines(text);
  return (
    <div className="bg-surface border border-border rounded-xl px-9 py-7 leading-[1.72] text-text">
      {lines.map((line, i) => {
        switch (line.kind) {
          case "blank":
            return <br key={i} />;
          case "heading":
            return (
              <h3
                key={i}
                className="text-text font-semibold text-[1.05rem] mt-5 mb-1.5 border-l-[3px] border-accent pl-3 -tracking-[0.01em]"
              >
                {line.text}
              </h3>
            );
          default:
            return (
              <p key={i} className="mb-1.5 text-[1rem]">
                {line.text}
              </p>
            );
        }
      })}
    </div>
  );
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
        <ReportBody text={reports[active]} />

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
        />
      </motion.div>
    </div>
  );
}
