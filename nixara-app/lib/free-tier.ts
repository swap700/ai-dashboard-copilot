/**
 * Mirrors the session-scoped free_reports_used counter (lines 1265-1266, 1385).
 * Uses sessionStorage to match Streamlit's per-browser-session semantics
 * (resets when the tab is closed, unlike localStorage).
 *
 * BUG FIX (2026-09): this counter is purely a client-side DISPLAY value —
 * the actual enforcement is the server-side HttpOnly cookie (nixara_ftu,
 * 30-day maxAge, see generate-report/route.ts), which is deliberately
 * built to survive tab closes and browser restarts. Because this counter
 * lives in sessionStorage, it resets to 0 in a new tab while the real,
 * persistent gate does not — producing a real, observed bug: the UI shows
 * "0 of 3 free reports used" while the server correctly rejects the
 * request with "you've used all 3." setFreeReportsUsed() lets the caller
 * sync this display counter to the server's authoritative freeRemaining
 * value after every request (success or blocked), instead of only ever
 * blindly incrementing a value that can already be wrong.
 */

const KEY = "nixara_free_reports_used";
export const FREE_LIMIT = 3;

export function getFreeReportsUsed(): number {
  if (typeof window === "undefined") return 0;
  return Number(window.sessionStorage.getItem(KEY) ?? "0");
}

/** Sets the counter to an authoritative value (e.g. derived from the
 * server's freeRemaining), rather than incrementing a possibly-stale one. */
export function setFreeReportsUsed(count: number): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(KEY, String(Math.max(0, count)));
}
