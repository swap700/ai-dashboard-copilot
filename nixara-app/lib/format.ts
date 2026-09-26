/**
 * Shared display-formatting utilities.
 *
 * BUG FIX (2026-08): both bugs below were type-detection working correctly
 * but nothing downstream ever formatting the *result* for a human to read.
 */

/**
 * Formats a number for display: max 2 decimal places, thousands separators,
 * and no trailing zeros for whole numbers. Fixes the raw floating-point sum
 * (e.g. "711232718.5799985") that came from adding tens of thousands of
 * 2-decimal values with no rounding applied afterward.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

/** Formats a 0-1-scale ratio as a percentage string, e.g. 0.165 -> "16.5%", -2.6 -> "-260%". */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${formatNumber(ratio * 100)}%`;
}

/**
 * Formats a value that may be a native JS Date (what ExcelJS/date-typed CSV
 * cells produce) into a short, human-readable, timezone-stable string.
 *
 * Two problems fixed at once:
 *  1. Cosmetic: raw `String(dateValue)` calls Date.prototype.toString(),
 *     which is the verbose "Tue Jan 30 2024 19:00:00 GMT-0500 (Eastern
 *     Standard Time)" format nobody wants to see in a data table.
 *  2. Correctness: that same toString() converts to the *viewer's local
 *     timezone*. Excel/ExcelJS dates are timezone-naive — the calendar date
 *     itself can silently shift by a day depending on where the report is
 *     being viewed from. We read the UTC components (getUTCFullYear, etc.)
 *     instead of local components, so the date shown is always the date
 *     that was actually in the spreadsheet, regardless of viewer timezone.
 *
 * Non-Date values pass through unchanged via String().
 */
export function formatCell(value: unknown): string {
  if (value instanceof Date) return formatDateSafe(value);
  return String(value ?? "");
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatDateSafe(d: Date): string {
  const y = d.getUTCFullYear();
  const m = MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();

  const datePart = `${m} ${day}, ${y}`;
  // Only show a time component if the cell actually encoded a non-midnight
  // time — most "date of admission"-style columns are date-only and the
  // 00:00:00 UTC time component is just an artifact of the serial-to-Date
  // conversion, not real information.
  if (hh === 0 && mm === 0) return datePart;

  const period = hh >= 12 ? "PM" : "AM";
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${datePart}, ${hour12}:${String(mm).padStart(2, "0")} ${period}`;
}

/** True if any row has a native Date value in this column. */
export function isDateColumn(rows: Record<string, unknown>[], col: string): boolean {
  return rows.some((r) => r[col] instanceof Date);
}

const BUCKET_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Buckets a Date column to "Mon YYYY" granularity for time-series charting.
 * A raw admission-timestamp column can have tens of thousands of distinct
 * values (every row unique to the second) — far too many to chart directly.
 * Bucketing to month gives a readable trend line regardless of how granular
 * the source timestamps are.
 */
export function monthBucketKey(d: Date): string {
  return `${BUCKET_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Sort key so month buckets sort chronologically, not alphabetically. */
export function monthBucketSortKey(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * Joins a list of display names into one readable string, capped so a
 * dataset with many flagged columns doesn't turn a one-line summary banner
 * into a wall of text: "A, B, C, D, E, F, +3 more" once past `max` names.
 *
 * BUG FIX (2026-09): AnomalyWarnings' "N columns show statistically unusual
 * values" banner computed the actual list of flagged columns and then threw
 * it away, keeping only the count -- the person reading it had no way to
 * tell WHICH columns without generating a full Risk Report and hoping the
 * model happened to mention all of them (it only surfaces ones it judged
 * risk-worthy, not the full deterministic list). This is what the banner
 * now renders that list with.
 */
export function joinWithOverflow(items: string[], max = 6): string {
  if (items.length === 0) return "";
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")}, +${items.length - max} more`;
}
