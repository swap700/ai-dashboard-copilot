"use client";

import { useMemo, useState } from "react";
import FileUploader from "@/components/FileUploader";
import MetricsRow from "@/components/MetricsRow";
import DataPreview from "@/components/DataPreview";
import Charts from "@/components/Charts";
import AnomalyWarnings from "@/components/AnomalyWarnings";
import { cleanDataset, dashboardScore, numericColumns } from "@/lib/data-analysis";
import type { Dataset } from "@/lib/data-analysis";

export default function DashboardPage() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [fileName, setFileName] = useState<string>("");

  const handleLoaded = (raw: Dataset, name: string) => {
    setDataset(cleanDataset(raw));
    setFileName(name);
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
        </>
      )}
    </div>
  );
}
