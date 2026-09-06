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
import type { ReportFailures, ReportSet } from "./report";

interface NixaraState {
  // ── Dataset ──────────────────────────────────────────────────────────────
  dataset: Dataset | null;
  fileName: string;
  // ── Report configuration ─────────────────────────────────────────────────
  setup: ReportSetupValue;
  // ── API key (in-memory only — never persisted) ───────────────────────────
  apiKey: string;
  // ── Generated reports ─────────────────────────────────────────────────────
  // Partial: any subset of the three calls can fail, and the ones that
  // succeeded are still worth showing (and were still paid for).
  reports: ReportSet | null;
  reportErrors: ReportFailures;
}

interface NixaraActions {
  /** Load a new dataset. Clears any prior generated reports. */
  setDataset: (dataset: Dataset | null, fileName?: string) => void;
  setSetup: (setup: ReportSetupValue) => void;
  setApiKey: (key: string) => void;
  setReports: (reports: ReportSet | null, errors?: ReportFailures) => void;
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
  reportErrors: {},

  setDataset: (dataset, fileName = "") =>
    set({ dataset, fileName, reports: null, reportErrors: {} }),
  setSetup: (setup) => set({ setup }),
  setApiKey: (apiKey) => set({ apiKey }),
  setReports: (reports, errors = {}) => set({ reports, reportErrors: errors }),
}));
