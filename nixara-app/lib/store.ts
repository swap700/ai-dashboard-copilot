/**
 * Global in-memory store (Zustand) for Nixara dashboard state.
 *
 * Survives Next.js client-side route changes (Home ↔ Outcomes) because the
 * store lives at the module level, not inside a React component. State is
 * cleared when the user closes the tab or hard-refreshes.
 *
 * IMPORTANT: keep sensitive data (apiKey) here but never in sessionStorage.
 */

import { create } from "zustand";
import type { Dataset } from "./data-analysis";
import type { ReportSetupValue } from "@/components/ReportSetup";
import type { ReportType } from "./report";

interface NixaraState {
  // ── Dataset ──────────────────────────────────────────────────────────────
  dataset: Dataset | null;
  fileName: string;
  // ── Report configuration ─────────────────────────────────────────────────
  setup: ReportSetupValue;
  // ── API key (in-memory only — never persisted) ───────────────────────────
  apiKey: string;
  // ── Generated report text ─────────────────────────────────────────────────
  reports: Record<ReportType, string> | null;
}

interface NixaraActions {
  /** Load a new dataset. Clears any prior generated reports. */
  setDataset: (dataset: Dataset | null, fileName?: string) => void;
  setSetup: (setup: ReportSetupValue) => void;
  setApiKey: (key: string) => void;
  setReports: (reports: Record<ReportType, string> | null) => void;
}

const DEFAULT_SETUP: ReportSetupValue = {
  who: "COO",
  decision: "",
  timeframe: "This quarter",
};

export const useNixaraStore = create<NixaraState & NixaraActions>((set) => ({
  dataset: null,
  fileName: "",
  setup: DEFAULT_SETUP,
  apiKey: "",
  reports: null,

  setDataset: (dataset, fileName = "") =>
    set({ dataset, fileName, reports: null }),
  setSetup: (setup) => set({ setup }),
  setApiKey: (apiKey) => set({ apiKey }),
  setReports: (reports) => set({ reports }),
}));
