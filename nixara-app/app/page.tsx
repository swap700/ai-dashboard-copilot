"use client";

import { useMemo, useState } from "react";
import FileUploader from "@/components/FileUploader";
import MetricsRow from "@/components/MetricsRow";
import DataPreview from "@/components/DataPreview";
import Charts from "@/components/Charts";
import AnomalyWarnings from "@/components/AnomalyWarnings";
import ReportSetup, { type ReportSetupValue } from "@/components/ReportSetup";
import ReportTabs from "@/components/ReportTabs";
import { buildDataSummary, cleanDataset, dashboardScore, numericColumns } from "@/lib/data-analysis";
import type { Dataset } from "@/lib/data-analysis";
import { REPORT_TYPES, type ReportType } from "@/lib/report";
import { incrementFreeReportsUsed } from "@/lib/free-tier";

export default function DashboardPage() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [setup, setSetup] = useState<ReportSetupValue>({
    who: "COO",
    decision: "",
    timeframe: "This quarter",
  });
  const [apiKey, setApiKey] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<ReportType, string> | null>(null);

  const handleLoaded = (raw: Dataset, name: string) => {
    setDataset(cleanDataset(raw));
    setFileName(name);
    setReports(null);
  };

  const metrics = useMemo(() => {
    if (!dataset) return [];
    return [
      { label: "Rows", value: dataset.rows.length },
      { label: "Columns", value: dataset.columns.length },
      { label: "Numeric fields", value: numericColumns(dataset).length },
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

  return (
    <div>
      <FileUploader onLoaded={handleLoaded} />

      {dataset && (
        <>
          <p className="text-text-dim text-xs uppercase tracking-wider font-semibold mb-3">
            {fileName} · {dataset.rows.length} rows
          </p>
          <MetricsRow metrics={metrics} />
          <DataPreview dataset={dataset} />
          <Charts dataset={dataset} />
          <AnomalyWarnings dataset={dataset} />

          <ReportSetup
            value={setup}
            onChange={setSetup}
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
