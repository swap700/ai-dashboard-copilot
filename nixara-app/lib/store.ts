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
  /**
   * Columns the user has marked as consequences of what is being measured,
   * rather than competing explanations for it.
   *
   * Nixara cannot tell the two apart from the data - age-causes-smoking and
   * smoking-causes-doctor-visits look identical to a correlation - so this is
   * the one piece of knowledge the user has and the file does not. Held here
   * rather than in sessionStorage because it belongs to the loaded dataset
   * and is cleared with it: carrying "doctor visits is a consequence" onto an
   * unrelated upload would silently drop a column from its analysis.
   */
  consequenceColumns: string[];
}

interface NixaraActions {
  /** Load a new dataset. Clears any prior generated reports. */
  setDataset: (dataset: Dataset | null, fileName?: string) => void;
  setSetup: (setup: ReportSetupValue) => void;
  setApiKey: (key: string) => void;
  setReports: (reports: ReportSet | null, errors?: ReportFailures) => void;
  /** Mark or unmark a column as a consequence. Clears any generated reports,
   *  since every controlled comparison in them was computed without it. */
  toggleConsequenceColumn: (column: string) => void;
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
  consequenceColumns: [],

  setDataset: (dataset, fileName = "") =>
    set({ dataset, fileName, reports: null, reportErrors: {}, consequenceColumns: [] }),
  setSetup: (setup) => set({ setup }),
  setApiKey: (apiKey) => set({ apiKey }),
  setReports: (reports, errors = {}) => set({ reports, reportErrors: errors }),
  toggleConsequenceColumn: (column) =>
    set((state) => ({
      consequenceColumns: state.consequenceColumns.includes(column)
        ? state.consequenceColumns.filter((c) => c !== column)
        : [...state.consequenceColumns, column],
      reports: null,
      reportErrors: {},
    })),
}));
