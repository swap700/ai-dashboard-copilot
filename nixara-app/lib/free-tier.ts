/**
 * Mirrors the session-scoped free_reports_used counter (lines 1265-1266, 1385).
 * Uses sessionStorage to match Streamlit's per-browser-session semantics
 * (resets when the tab is closed, unlike localStorage).
 */

const KEY = "nixara_free_reports_used";
export const FREE_LIMIT = 3;

export function getFreeReportsUsed(): number {
  if (typeof window === "undefined") return 0;
  return Number(window.sessionStorage.getItem(KEY) ?? "0");
}

export function incrementFreeReportsUsed(): number {
  const next = getFreeReportsUsed() + 1;
  window.sessionStorage.setItem(KEY, String(next));
  return next;
}
