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
import { REPORT_TYPES, type ReportType } from "@/lib/report";
import { incrementFreeReportsUsed } from "@/lib/free-tier";

export default function DashboardPage() {
  // ── Global store — survives navigation to Outcomes and back ──────────────
  const { dataset, fileName, setup, apiKey, reports, setDataset, setSetup, setApiKey, setReports } =
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
      const usingOwnKey = apiKey.trim().startsWith("sk-");
      const next: Partial<Record<ReportType, string>> = {};

      // One UUID per button click — shared across all report-type calls so the
      // server counts this as a single generate SESSION, not 3 separate uses.
      const sessionId = crypto.randomUUID();

      for (const reportType of REPORT_TYPES) {
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
        if (!res.ok) throw new Error(data.error ?? "Report generation failed.");
        next[reportType] = data.text;
        if (data.tier === "free" && !usingOwnKey) incrementFreeReportsUsed();
      }

      setReports(next as Record<ReportType, string>);
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
            <ReportTabs reports={reports} context={{ ...setup, datasetName: fileName }} />
          )}
        </>
      )}
    </div>
  );
}
