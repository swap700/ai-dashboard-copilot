"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { REPORT_TYPES, type ReportFailures, type ReportSet, type ReportType } from "@/lib/report";
import { buildVisualSections, countUnverifiedFigures, listUnverifiedFigures } from "@/lib/report-visual";
import { buildEvidenceFacts } from "@/lib/evidence";
import { dashboardScore, describeUnmeasuredColumns, detectMissingValuesByColumn, detectMalformedEntries, type Dataset } from "@/lib/data-analysis";
import type { ReportSetupValue } from "./ReportSetup";
import DecisionPanel from "./DecisionPanel";
import ReportVisualBody from "./ReportVisual";
import RiskEvidencePanel from "./RiskEvidencePanel";

interface Props {
  reports: ReportSet;
  errors: ReportFailures;
  context: ReportSetupValue & { datasetName: string };
  /**
   * Columns the user marked as consequences in ConfoundingPanel. Needed here
   * because the evidence facts have to be built from the SAME inputs the
   * summary was, or the checker will not recognise figures it handed the
   * model itself.
   */
  consequenceColumns?: string[];
  /**
   * Evidence Trail needs the source rows to rebuild the same stats the report
   * was generated from. Optional so ReportTabs still renders (minus evidence
   * links) in the unlikely case a caller doesn't have the dataset in scope.
   */
  dataset?: Dataset | null;
  /**
   * Incrementing counter from a parent (e.g. the upload-screen "N real data
   * issues found" link in AnomalyWarnings). Any change — not the value
   * itself — switches to the Risk Report tab and scrolls to the Data
   * Quality Risks card. A counter rather than a boolean so clicking the
   * link twice in a row (already on that tab, already scrolled) still
   * re-triggers the scroll instead of being a no-op on the second click.
   */
  jumpToDataQuality?: number;
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

export default function ReportTabs({ reports, errors, context, dataset, jumpToDataQuality, consequenceColumns = [] }: Props) {
  // Computed once per dataset (not per report/tab render) — buildEvidenceFacts
  // walks every business-metric column plus a few category breakdowns, which
  // is the same order of work buildDataSummary already does at generate time,
  // not something to redo on every tab switch.
  const evidenceFacts = useMemo(
    () =>
      dataset
        ? buildEvidenceFacts(dataset, { question: context.decision, consequenceColumns })
        : [],
    [dataset, context.decision, consequenceColumns]
  );

  // The Risk Report's Data Quality section is fed this directly instead of
  // trusting the model to have restated it correctly in its own prose — see
  // report-visual.ts's dataQuality case.
  const qualityScore = useMemo(() => (dataset ? dashboardScore(dataset) : null), [dataset]);
  const missingValues = useMemo(() => (dataset ? detectMissingValuesByColumn(dataset) : []), [dataset]);
  const malformedEntries = useMemo(() => (dataset ? detectMalformedEntries(dataset) : []), [dataset]);
  // Columns that held numbers but did not clear the metric bar, with the reason
  // each one was set aside. Same deterministic source as the two above.
  const unmeasured = useMemo(() => (dataset ? describeUnmeasuredColumns(dataset) : []), [dataset]);

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

  // Tab switch: a render-time adjustment, same pattern this file already
  // uses for resetting `active` when `reports` changes (see renderedFor
  // above) - not an effect, since calling setState synchronously inside a
  // useEffect body causes an avoidable extra commit-then-rerender pass for
  // something that can be corrected during the same render instead.
  const [renderedForJump, setRenderedForJump] = useState(jumpToDataQuality);
  if (jumpToDataQuality !== undefined && jumpToDataQuality !== renderedForJump && reports["Risk Report"]) {
    setRenderedForJump(jumpToDataQuality);
    setActive("Risk Report");
  }

  // The scroll itself is a genuine side effect (DOM manipulation after
  // commit) and belongs in a useEffect, unlike the state update above - it
  // tracks jumpToDataQuality with its own ref rather than reusing
  // renderedForJump, since that state will already equal the new value by
  // the time this effect runs (the render-time adjustment above updates it
  // synchronously, earlier in the same render).
  const prevScrollJumpRef = useRef(jumpToDataQuality);
  useEffect(() => {
    if (jumpToDataQuality === undefined || jumpToDataQuality === prevScrollJumpRef.current) return;
    prevScrollJumpRef.current = jumpToDataQuality;
    if (!reports["Risk Report"]) return; // nothing to jump to yet

    // A single requestAnimationFrame isn't guaranteed to run after React has
    // actually committed the tab switch — the target element may not exist
    // in the DOM yet on the first attempt if Risk Report wasn't already the
    // active tab. Retry a few times over a short window rather than trust
    // exact frame timing; gives up silently (no error, no scroll) past that,
    // since a failed cosmetic scroll shouldn't be a visible failure mode.
    let attempts = 0;
    const tryScroll = () => {
      const el = document.getElementById("data-quality-risks-section");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (attempts++ < 10) {
        setTimeout(tryScroll, 30);
      }
    };
    requestAnimationFrame(tryScroll);
  }, [jumpToDataQuality, reports]);

  const current = reports[active];
  const currentError = errors[active];

  // Computed once per report/tab (not re-derived inside the JSX below) so the
  // same sections feed both the "N figures unverified" summary banner and
  // ReportVisualBody -- see countUnverifiedFigures' doc comment (report-visual.ts)
  // for why this replaced a per-figure badge repeated next to every flagged number.
  const sections = useMemo(
    () => (current ? buildVisualSections(current.text, active, evidenceFacts, qualityScore, missingValues, malformedEntries, unmeasured) : []),
    [current, active, evidenceFacts, qualityScore, missingValues, malformedEntries, unmeasured]
  );
  const unverifiedCount = useMemo(() => countUnverifiedFigures(sections), [sections]);
  const unverifiedFigures = useMemo(() => listUnverifiedFigures(sections), [sections]);

  // Scrolls to the nth rendered occurrence of a flagged figure. Figures are
  // marked in the DOM with data-unverified-figure (ReportVisual.tsx); matching
  // by text plus occurrence index keeps this working without threading ids
  // through every section component.
  const jumpToFigure = (figure: string, nth: number) => {
    const matches = Array.from(document.querySelectorAll<HTMLElement>("[data-unverified-figure]")).filter(
      (el) => el.dataset.unverifiedFigure === figure
    );
    (matches[nth] ?? matches[0])?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

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

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-bg px-3 py-2 mb-4 text-[0.72rem] text-text-mute">
              <span className="font-semibold text-text">Reading this report:</span>
              <span>
                <span className="font-semibold text-accent">{"\u{1F50D}"} source</span> traced to your data
              </span>
              <span>
                <span className="font-semibold text-accent">{"\u{1F9EE}"} calculated</span> computed by Nixara from your data
              </span>
              <span>
                <span className="font-semibold text-warn border-b-2 border-dotted border-warn">unverified</span> could not be
                matched, may still be right
              </span>
            </div>

            {current.corrected && current.correctedFigures && current.correctedFigures.length > 0 && (
              /*
                Amber, not green. Green reads as "all good"; this banner exists
                to say part of the first draft was weaker than it looked.

                Only figures the rewrite actually RESOLVED appear here. Anything
                still unmatched survives into the text below and is marked amber
                inline, so no figure is ever reported twice.
              */
              <div className="rounded-lg border border-warn-border bg-warn-bg px-4 py-3 mb-4" role="status">
                <p className="text-warn text-sm font-semibold mb-1">
                  Nixara checked this report against your file and changed{" "}
                  {current.correctedFigures.length === 1
                    ? "1 number"
                    : `${current.correctedFigures.length} numbers`}
                </p>
                <p className="text-text-mute text-sm">
                  A first draft cited{" "}
                  {current.correctedFigures.length === 1 ? "a figure that matched" : "figures that matched"}{" "}
                  nothing in your data. Nixara asked for a rewrite, and this is the result.
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs mt-2.5 mb-2">
                    <thead>
                      <tr className="text-left">
                        <th className="font-semibold text-text-mute uppercase tracking-wider text-[0.66rem] pr-3 pb-1.5 border-b border-warn-border whitespace-nowrap">
                          First draft said
                        </th>
                        <th className="font-semibold text-text-mute uppercase tracking-wider text-[0.66rem] pr-3 pb-1.5 border-b border-warn-border whitespace-nowrap">
                          Where
                        </th>
                        <th className="font-semibold text-text-mute uppercase tracking-wider text-[0.66rem] pb-1.5 border-b border-warn-border whitespace-nowrap">
                          Outcome
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.correctedFigures.map((f, i) => (
                        <tr key={`${f.figure}-${i}`} className="align-top">
                          <td className="pr-3 py-1.5 font-bold text-text whitespace-nowrap tabular-nums">
                            {f.figure}
                          </td>
                          <td className="pr-3 py-1.5 text-text-mute">
                            {f.section ?? "elsewhere in the report"}
                          </td>
                          <td className="py-1.5">
                            {f.outcome === "corrected" ? (
                              <span className="text-success font-semibold whitespace-nowrap">
                                replaced with a figure from your data
                              </span>
                            ) : (
                              <span className="text-accent-text-dk font-semibold whitespace-nowrap">
                                number removed, wording kept
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-text-mute text-sm">
                  Being unmatched does not make a figure wrong. It means Nixara could not prove it
                  from your data, so it chose not to stand behind it.
                </p>
              </div>
            )}

            {unverifiedCount > 0 && (
              <div className="rounded-lg border border-warn-border bg-warn-bg px-4 py-3 mb-4" role="status">
                <p className="text-warn text-sm font-semibold mb-0.5">
                  {unverifiedCount === 1
                    ? "1 figure in this version could not be confirmed against your data."
                    : `${unverifiedCount} figures in this version could not be confirmed against your data.`}
                </p>
                {unverifiedFigures.length > 0 && (
                  <ul className="text-sm mt-1 space-y-0.5">
                    {unverifiedFigures.map((u, i) => {
                      const nth = unverifiedFigures.slice(0, i).filter((x) => x.figure === u.figure).length;
                      return (
                        <li key={`${u.where}-${i}`}>
                          <button
                            type="button"
                            onClick={() => jumpToFigure(u.figure, nth)}
                            className="font-semibold text-accent-dk underline hover:no-underline"
                          >
                            {u.figure}
                          </button>{" "}
                          <span className="text-text-mute">{u.where}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="text-text-mute text-sm mt-1">
                  Click a figure to jump to it. Check {unverifiedCount === 1 ? "it" : "these"} before acting on{" "}
                  {unverifiedCount === 1 ? "it" : "them"}.
                </p>
              </div>
            )}

            {/* The computed half of every report, above the model's prose.
                The 3x3 likelihood-by-impact matrix that used to sit on the
                Risk Report was drawn from two words a model invented;
                everything in this panel is arithmetic on the file, and a
                figure the file cannot support does not render at all.

                Charts only on the Risk Report, because that is the tab whose
                subject is where the exposure sits. The other two get the
                figures without them, so no tab looks thinner than its
                neighbour. */}
            {dataset && (
              <RiskEvidencePanel
                dataset={dataset}
                question={context.decision}
                variant={active === "Risk Report" ? "full" : "compact"}
              />
            )}
            <ReportVisualBody sections={sections} />

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
              dataset={dataset}
            />
          </>
        )}
      </motion.div>
    </div>
  );
}
