"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { REPORT_TYPES, type ReportFailures, type ReportSet, type ReportType } from "@/lib/report";
import { buildVisualSections } from "@/lib/report-visual";
import { buildEvidenceFacts } from "@/lib/evidence";
import type { Dataset } from "@/lib/data-analysis";
import type { ReportSetupValue } from "./ReportSetup";
import DecisionPanel from "./DecisionPanel";
import ReportVisualBody from "./ReportVisual";

interface Props {
  reports: ReportSet;
  errors: ReportFailures;
  context: ReportSetupValue & { datasetName: string };
  /**
   * Evidence Trail needs the source rows to rebuild the same stats the report
   * was generated from. Optional so ReportTabs still renders (minus evidence
   * links) in the unlikely case a caller doesn't have the dataset in scope.
   */
  dataset?: Dataset | null;
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

export default function ReportTabs({ reports, errors, context, dataset }: Props) {
  // Computed once per dataset (not per report/tab render) — buildEvidenceFacts
  // walks every business-metric column plus a few category breakdowns, which
  // is the same order of work buildDataSummary already does at generate time,
  // not something to redo on every tab switch.
  const evidenceFacts = useMemo(() => (dataset ? buildEvidenceFacts(dataset) : []), [dataset]);

  // Open on a tab that actually has a report. With partial results the first
  // report type is not necessarily one of the ones that came back.
  const firstAvailable = REPORT_TYPES.find((t) => reports[t]) ?? REPORT_TYPES[0];
  const [active, setActive] = useState<ReportType>(firstAvailable);

  // Reset the selected tab when a new set of reports arrives. Done as a
  // render-time adjustment rather than an effect - see React's "You Might Not
  // Need an Effect": storing the previous prop and correcting during render
  // avoids the extra commit-then-rerender pass an effect would cause.
  const [renderedFor, setRenderedFor] = useState<ReportSet>(reports);
  if (renderedFor !== reports) {
    setRenderedFor(reports);
    setActive(firstAvailable);
  }

  const current = reports[active];
  const currentError = errors[active];

  return (
    <div className="mb-10">
      <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-3">AI Reports</p>

      <div className="flex border-b-2 border-border mb-5">
        {REPORT_TYPES.map((type) => {
          const failed = !reports[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => setActive(type)}
              title={failed ? errors[type] ?? "Not generated" : undefined}
              className={`px-5 py-2.5 text-sm font-medium -mb-0.5 border-b-2 transition-colors ${
                active === type
                  ? "text-accent border-accent font-semibold"
                  : failed
                  ? "text-text-dim/60 border-transparent hover:text-text-dim"
                  : "text-text-dim border-transparent hover:text-accent hover:bg-accent-bg-soft"
              }`}
            >
              {type}
              {failed && <span className="ml-1.5 text-danger" aria-label="not generated">!</span>}
            </button>
          );
        })}
      </div>

      <motion.div
        key={active}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {!current ? (
          <div
            className="rounded-lg border border-danger-border bg-danger-bg px-4 py-4"
            role="alert"
          >
            <p className="text-danger text-sm font-semibold mb-1">
              This report could not be generated.
            </p>
            <p className="text-text-mute text-sm">
              {currentError ?? "No report was returned for this type."}
            </p>
            <p className="text-text-mute text-sm mt-2">
              The other reports from this run are unaffected - switch tabs to see them, or
              press Generate Reports again to retry.
            </p>
          </div>
        ) : (
          <>
            {current.truncated && (
              <div
                className="rounded-lg border border-warn-border bg-warn-bg px-4 py-3 mb-4"
                role="status"
              >
                <p className="text-warn text-sm font-semibold mb-0.5">
                  This report is cut off.
                </p>
                <p className="text-text-mute text-sm">
                  The model reached its length limit before finishing, so the end of this
                  report is missing. Treat the final section as incomplete rather than as a
                  short answer, and regenerate if you need the full version.
                </p>
              </div>
            )}

            <ReportVisualBody sections={buildVisualSections(current.text, active, evidenceFacts)} />

            <div className="grid grid-cols-2 gap-3 mt-4">
              <button
                type="button"
                onClick={() => downloadExport("docx", current.text, active, context)}
                className="border border-border rounded-lg py-2 text-sm font-medium text-text-mute hover:border-accent hover:text-accent hover:bg-accent-bg-soft transition-colors"
              >
                ↓ Download as Word
              </button>
              <button
                type="button"
                onClick={() => downloadExport("pdf", current.text, active, context)}
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
              reportText={current.text}
            />
          </>
        )}
      </motion.div>
    </div>
  );
}
