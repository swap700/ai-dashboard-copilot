"use client";

import { useApiKey } from "@/lib/use-api-key";
import { FREE_LIMIT, getFreeReportsUsed } from "@/lib/free-tier";
import { useEffect, useState } from "react";

const ROLES = ["COO", "CEO", "CFO", "Sales Lead", "Operations Lead", "Board"];
const TIMEFRAMES = ["Next 30 days", "This quarter", "This year"];

export interface ReportSetupValue {
  who: string;
  decision: string;
  timeframe: string;
}

interface Props {
  value: ReportSetupValue;
  onChange: (value: ReportSetupValue) => void;
  apiKey: string;
  onApiKeyResolved: (key: string) => void;
  onGenerate: () => void;
  generating: boolean;
}

export default function ReportSetup({ value, onChange, onApiKeyResolved, onGenerate, generating }: Props) {
  const { apiKey, setApiKey } = useApiKey();
  const [freeUsed, setFreeUsed] = useState(0);

  useEffect(() => {
    setFreeUsed(getFreeReportsUsed());
  }, []);

  useEffect(() => {
    onApiKeyResolved(apiKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const usingOwnKey = apiKey.trim().startsWith("sk-") || apiKey.trim().length > 0;
  const capHit = !usingOwnKey && freeUsed >= FREE_LIMIT;
  const keyReady = usingOwnKey || !capHit;

  let keyStatus: { text: string; className: string } | null = null;
  if (apiKey && apiKey.startsWith("sk-")) {
    keyStatus = { text: "✓ Key active", className: "text-success" };
  } else if (apiKey) {
    keyStatus = { text: "⚠ Key format incorrect", className: "text-danger" };
  } else {
    keyStatus = { text: "◉ Free tier active — see counter below", className: "text-accent" };
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 mb-8 space-y-4">
      <p className="text-text-dim text-xs uppercase tracking-wider font-semibold">Report Setup</p>

      <div>
        <label className="block text-sm font-medium text-text mb-1">Decision Context</label>
        <textarea
          value={value.decision}
          onChange={(e) => onChange({ ...value, decision: e.target.value })}
          placeholder="Which sub-category sells best in Texas?"
          rows={2}
          className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text mb-1">Role</label>
          <select
            value={value.who}
            onChange={(e) => onChange({ ...value, who: e.target.value })}
            className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Time Horizon</label>
          <select
            value={value.timeframe}
            onChange={(e) => onChange({ ...value, timeframe: e.target.value })}
            className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text"
          >
            {TIMEFRAMES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text mb-1">OpenAI API Key (optional)</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-proj-..."
          className="w-full rounded-lg border border-border bg-accent-bg-soft px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
        />
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-xs text-text-mute">Not stored — cleared when you close or refresh this tab.</span>
          {keyStatus && <span className={`text-xs font-medium ${keyStatus.className}`}>{keyStatus.text}</span>}
        </div>
      </div>

      {!usingOwnKey && (
        <p className="text-xs text-text-dim">
          {capHit
            ? "You've reached the free limit for this session. Paste your OpenAI key above to keep going — it stays in your browser only."
            : freeUsed === FREE_LIMIT - 1
            ? `You've used ${freeUsed} of ${FREE_LIMIT} free reports. Enter your OpenAI key above for unlimited access.`
            : `${freeUsed} of ${FREE_LIMIT} free reports used this session.`}
        </p>
      )}

      <button
        type="button"
        onClick={onGenerate}
        disabled={!keyReady || !value.decision.trim() || generating}
        className="w-full bg-accent text-white font-semibold text-sm rounded-lg py-2.5 transition-colors hover:bg-accent-dk disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {generating ? "Generating…" : "Generate Reports"}
      </button>
    </div>
  );
}
