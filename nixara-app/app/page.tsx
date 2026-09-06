"use client";

import { useMemo, useState } from "react";
import { useNixaraStore } from "@/lib/store";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useSession } from "@/lib/session-context";
import BIConnector from "@/components/BIConnector";
import MetricsRow from "@/components/MetricsRow";
import DataPreview from "@/components/DataPreview";
import Charts from "@/components/Charts";
import AnomalyWarnings from "@/components/AnomalyWarnings";
import ReportSetup, { type ReportSetupValue } from "@/components/ReportSetup";
import ReportTabs from "@/components/ReportTabs";
import { buildDataSummary, dashboardScore, numericColumns } from "@/lib/data-analysis";
import type { Dataset } from "@/lib/data-analysis";
import { REPORT_TYPES, type ReportFailures, type ReportSet, type ReportType } from "@/lib/report";
import { FREE_LIMIT, setFreeReportsUsed } from "@/lib/free-tier";

export default function DashboardPage() {
  // ── Global store — survives navigation to Outcomes and back ──────────────
  const { dataset, fileName, setup, apiKey, reports, reportErrors, setDataset, setSetup, setApiKey, setReports } =
    useNixaraStore();

  // ── Session context — decisions + outcomes ────────────────────────────────
  const { clearDecisions } = useSession();

  // ── Transient UI state (don't need to survive navigation) ────────────────
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bug fix (React error #185): only feed Charts a new decision text after
  // the user pauses typing — see use-debounced-value.ts for the full story.
  const debouncedDecision = useDebouncedValue(setup.decision, 400);

  // BIConnector already calls cleanDataset before calling onLoaded.
  // Clear prior decisions so they don't ghost-persist from a previous dataset.
  const handleLoaded = (dataset: Dataset, name: string) => {
    setDataset(dataset, name);
    clearDecisions();
  };

  const metrics = useMemo(() => {
    if (!dataset) return [];
    return [
      { label: "Rows",          value: dataset.rows.length },
      { label: "Columns",       value: dataset.columns.length },
      { label: "Numeric fields",value: numericColumns(dataset).length },
      { label: "Quality score", value: dashboardScore(dataset) },
    ];
  }, [dataset]);

  const handleGenerate = async () => {
    if (!dataset) return;
    setGenerating(true);
    setError(null);
    try {
      const summary = buildDataSummary(dataset);

      // One UUID per button click - shared across all report-type calls so the
      // server counts this as a single generate SESSION, not 3 separate uses.
      const sessionId = crypto.randomUUID();

      const requestOne = async (reportType: ReportType) => {
        const res = await fetch("/api/generate-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            who: setup.who,
            decision: setup.decision,
            timeframe: setup.timeframe,
            reportType,
            summary,
            userKey: apiKey,
            sessionId,
          }),
        });
        const data = await res.json();

        // Sync the display counter to the server's authoritative freeRemaining
        // whenever it is present, on both the success and the blocked path.
        // A purely local counter can show "0 of 3 used" in a fresh tab while
        // the persistent server-side gate correctly still remembers all 3.
        if (data.freeRemaining !== undefined && data.tier !== "own" && data.tier !== "admin") {
          setFreeReportsUsed(FREE_LIMIT - data.freeRemaining);
        }

        if (!res.ok) {
          const err = new Error(data.error ?? "Report generation failed.") as Error & {
            status?: number;
          };
          err.status = res.status;
          throw err;
        }
        return { text: data.text as string, truncated: Boolean(data.truncated) };
      };

      const results: ReportSet = {};
      const failures: ReportFailures = {};
      const record = (type: ReportType, outcome: PromiseSettledResult<{ text: string; truncated: boolean }>) => {
        if (outcome.status === "fulfilled") results[type] = outcome.value;
        else failures[type] = outcome.reason?.message ?? "Report generation failed.";
      };

      // The first call runs on its own, then the rest run together.
      //
      // Not an arbitrary choice: the first response is what sets the free-tier
      // cookie and consumes this session's quota unit. Firing all three at once
      // would send the same pre-update cookie three times, and the server would
      // count one click as three separate generate sessions - burning the
      // user's free allowance 3x faster. Awaiting the first means calls two and
      // three carry the updated cookie and are recognised as the same session.
      const [firstType, ...restTypes] = REPORT_TYPES;
      const firstOutcome = await Promise.allSettled([requestOne(firstType)]);
      record(firstType, firstOutcome[0]);

      // If the first call was refused by a gate (rate limit, quota, free tier
      // exhausted, backend unavailable) the other two would be refused too.
      // Anything else - a timeout, a transient upstream error - is worth
      // retrying the siblings for, since they are independent calls.
      const firstStatus =
        firstOutcome[0].status === "rejected"
          ? (firstOutcome[0].reason as { status?: number })?.status
          : undefined;
      const gated = firstStatus === 429 || firstStatus === 503 || firstStatus === 401;

      if (!gated) {
        const restOutcomes = await Promise.allSettled(restTypes.map(requestOne));
        restTypes.forEach((type, i) => record(type, restOutcomes[i]));
      } else {
        for (const type of restTypes) failures[type] = failures[firstType] ?? "Not attempted.";
      }

      const succeeded = Object.keys(results).length;
      if (succeeded === 0) {
        // Nothing to show - surface the reason at the top of the page.
        setError(failures[firstType] ?? "Something went wrong generating reports.");
        setReports(null, failures);
      } else {
        // Keep whatever came back. Previously a single failure discarded every
        // report from this click, including ones already paid for.
        setReports(results, failures);
        if (succeeded < REPORT_TYPES.length) {
          setError(
            `${REPORT_TYPES.length - succeeded} of ${REPORT_TYPES.length} reports could not be generated. ` +
              "The others are below."
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong generating reports.");
    } finally {
      setGenerating(false);
    }
  };

  // ReportSetup calls onApiKeyResolved which needs the setter signature
  const handleSetup = (v: ReportSetupValue) => setSetup(v);

  return (
    <div>
      <BIConnector onLoaded={handleLoaded} />

      {dataset && (
        <>
          <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-3">
            {fileName} · {dataset.rows.length} rows
          </p>
          <MetricsRow metrics={metrics} />
          <DataPreview dataset={dataset} />
          <Charts dataset={dataset} decisionText={debouncedDecision} />
          <AnomalyWarnings dataset={dataset} />

          <ReportSetup
            value={setup}
            onChange={handleSetup}
            apiKey={apiKey}
            onApiKeyResolved={setApiKey}
            onGenerate={handleGenerate}
            generating={generating}
          />

          {error && (
            <p className="text-danger text-sm mb-6 text-center" role="alert">
              {error}
            </p>
          )}

          {reports && (
            <ReportTabs
              reports={reports}
              errors={reportErrors}
              context={{ ...setup, datasetName: fileName }}
            />
          )}
        </>
      )}
    </div>
  );
}
