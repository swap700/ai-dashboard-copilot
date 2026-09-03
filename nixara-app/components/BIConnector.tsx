"use client";

import { useCallback, useRef, useState } from "react";
import { loadFile, parseCsvText } from "@/lib/file-parser";
import { cleanDataset } from "@/lib/data-analysis";
import { useSession } from "@/lib/session-context";
import type { Dataset } from "@/lib/data-analysis";

type Source = "upload" | "tableau" | "powerbi";

interface Props {
  onLoaded: (dataset: Dataset, fileName: string) => void;
}

// ── Shared input style ────────────────────────────────────────────────────────
const INPUT =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text " +
  "placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent";

// ── Source tab button ─────────────────────────────────────────────────────────
function SourceTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? "bg-accent text-white"
          : "text-text-mute hover:text-text hover:bg-surface"
      }`}
    >
      {label}
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// UPLOAD TAB
// ═════════════════════════════════════════════════════════════════════════════
function UploadTab({ onLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { logFileUpload } = useSession();

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);
      try {
        const raw = await loadFile(file);
        const dataset = cleanDataset(raw);
        const ext = file.name.split(".").pop()?.toLowerCase();
        const source = ext === "csv" ? "csv" : "excel";
        logFileUpload(source, dataset.rows.length, dataset.columns.length);
        onLoaded(dataset, file.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to parse file.");
      } finally {
        setLoading(false);
      }
    },
    [onLoaded, logFileUpload]
  );

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={`rounded-xl border-[1.5px] border-dashed cursor-pointer transition-colors px-6 py-10 text-center ${
          dragging ? "border-accent bg-accent-bg-soft" : "border-accent-lt bg-accent-bg-soft"
        }`}
      >
        <p className="text-accent-lt font-semibold text-sm">
          {loading ? "Parsing…" : "Drop a CSV or Excel file here, or click to browse"}
        </p>
        <p className="text-text-dim text-xs mt-1">.csv, .xlsx, .xls</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
      {error && (
        <p className="text-danger text-xs mt-2 text-center" role="alert">{error}</p>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TABLEAU TAB
// ═════════════════════════════════════════════════════════════════════════════
function TableauTab({ onLoaded }: Props) {
  const [server, setServer]           = useState("");
  const [siteId, setSiteId]           = useState("");
  const [tokenName, setTokenName]     = useState("");
  const [tokenSecret, setTokenSecret] = useState("");
  const [viewName, setViewName]       = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const { logFileUpload }             = useSession();

  const handleConnect = async () => {
    if (!server || !tokenName || !tokenSecret || !viewName) {
      setError("Please fill in Server URL, Token Name, Token Secret, and View Name.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/connect/tableau", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server, siteId, tokenName, tokenSecret, viewName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Tableau connection failed.");
      const dataset = cleanDataset(parseCsvText(data.csvText));
      logFileUpload("tableau", dataset.rows.length, dataset.columns.length);
      onLoaded(dataset, data.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tableau connection failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-text-mute text-xs mb-1">
        Connect via a Tableau Personal Access Token. Your credentials are used only to fetch
        the view data and are never stored.
      </p>
      <div className="grid grid-cols-1 gap-2.5">
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">Server URL</label>
          <input
            className={INPUT}
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="https://us-east-1.online.tableau.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">
            Site ID <span className="opacity-60">(leave blank for Default site)</span>
          </label>
          <input
            className={INPUT}
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            placeholder="mysite  (or leave blank)"
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-xs font-medium text-text-mute mb-1">Token Name</label>
            <input
              className={INPUT}
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="MyToken"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-mute mb-1">Token Secret</label>
            <input
              className={INPUT}
              type="password"
              value={tokenSecret}
              onChange={(e) => setTokenSecret(e.target.value)}
              placeholder="••••••••"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">View Name</label>
          <input
            className={INPUT}
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="Sales Overview"
          />
        </div>
      </div>
      {error && (
        <p className="text-danger text-xs mt-1" role="alert">{error}</p>
      )}
      <button
        type="button"
        disabled={loading}
        onClick={handleConnect}
        className="w-full rounded-lg bg-accent text-white font-semibold text-sm py-2.5 hover:opacity-90 disabled:opacity-40 transition-opacity"
      >
        {loading ? "Connecting to Tableau…" : "Connect to Tableau"}
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// POWER BI TAB
// ═════════════════════════════════════════════════════════════════════════════
function PowerBITab({ onLoaded }: Props) {
  const [tenantId, setTenantId]           = useState("");
  const [clientId, setClientId]           = useState("");
  const [clientSecret, setClientSecret]   = useState("");
  const [workspaceId, setWorkspaceId]     = useState("");
  const [datasetId, setDatasetId]         = useState("");
  const [tables, setTables]               = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [step, setStep]                   = useState<"credentials" | "tables">("credentials");
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const { logFileUpload }                 = useSession();

  const creds = { tenantId, clientId, clientSecret, workspaceId, datasetId };

  const handleConnect = async () => {
    if (!tenantId || !clientId || !clientSecret || !workspaceId || !datasetId) {
      setError("Please fill in all Power BI credentials.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/connect/powerbi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-tables", ...creds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Power BI connection failed.");
      if (!data.tables?.length) throw new Error("Connected but no tables found in this dataset.");
      setTables(data.tables);
      setSelectedTable(data.tables[0]);
      setStep("tables");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Power BI connection failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async () => {
    if (!selectedTable) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/connect/powerbi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetch-table", ...creds, tableName: selectedTable }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch table.");
      const dataset = cleanDataset(parseCsvText(data.csvText));
      logFileUpload("powerbi", dataset.rows.length, dataset.columns.length);
      onLoaded(dataset, data.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Power BI fetch failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-text-mute text-xs mb-1">
        Authenticate with Azure AD (service principal) to pull live dataset tables.
        Your credentials are used only to fetch data and are never stored.
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">Tenant ID</label>
          <input className={INPUT} value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="xxxxxxxx-xxxx-…" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">Client ID</label>
          <input className={INPUT} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxxxxxx-xxxx-…" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">Client Secret</label>
          <input className={INPUT} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="••••••••" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-mute mb-1">Workspace ID</label>
          <input className={INPUT} value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} placeholder="xxxxxxxx-xxxx-…" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-text-mute mb-1">Dataset ID</label>
          <input className={INPUT} value={datasetId} onChange={(e) => setDatasetId(e.target.value)} placeholder="xxxxxxxx-xxxx-…" />
        </div>
      </div>
      {step === "tables" && (
        <div className="rounded-lg bg-success-bg border border-success-border px-4 py-3">
          <p className="text-success text-xs font-semibold mb-2">
            Connected - {tables.length} table{tables.length !== 1 ? "s" : ""} found
          </p>
          <label className="block text-xs font-medium text-text-mute mb-1">Select table to load</label>
          <select
            className={INPUT}
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
          >
            {tables.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <p className="text-danger text-xs mt-1" role="alert">{error}</p>
      )}
      {step === "credentials" ? (
        <button
          type="button"
          disabled={loading}
          onClick={handleConnect}
          className="w-full rounded-lg bg-accent text-white font-semibold text-sm py-2.5 hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {loading ? "Authenticating…" : "Connect to Power BI"}
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={handleLoad}
            className="flex-1 rounded-lg bg-accent text-white font-semibold text-sm py-2.5 hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {loading ? "Loading data…" : `Load "${selectedTable}"`}
          </button>
          <button
            type="button"
            onClick={() => { setStep("credentials"); setTables([]); setError(null); }}
            className="px-4 rounded-lg border border-border text-text-mute text-sm hover:bg-surface transition-colors"
          >
            Back
          </button>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ROOT COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function BIConnector({ onLoaded }: Props) {
  const [source, setSource] = useState<Source>("upload");

  return (
    <div className="mb-6">
      <div className="flex items-center gap-1 mb-4 p-1 bg-accent-bg-soft rounded-lg border border-accent-border w-fit">
        <SourceTab label="Upload CSV / Excel" active={source === "upload"}  onClick={() => setSource("upload")} />
        <SourceTab label="Tableau"            active={source === "tableau"} onClick={() => setSource("tableau")} />
        <SourceTab label="Power BI"           active={source === "powerbi"} onClick={() => setSource("powerbi")} />
      </div>
      {source === "upload"  && <UploadTab  onLoaded={onLoaded} />}
      {source === "tableau" && (
        <div className="rounded-xl border border-border bg-surface px-5 py-5">
          <TableauTab onLoaded={onLoaded} />
        </div>
      )}
      {source === "powerbi" && (
        <div className="rounded-xl border border-border bg-surface px-5 py-5">
          <PowerBITab onLoaded={onLoaded} />
        </div>
      )}
    </div>
  );
}