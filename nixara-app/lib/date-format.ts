/**
 * Column-level date parsing, for the same reason number-format.ts exists.
 *
 * Until Oct 2026 a time chart could only ever appear for an Excel upload.
 * findDateColumn() and bucketByMonth() both test `instanceof Date`, and the
 * only parser that ever produced a Date object was ExcelJS. PapaParse's
 * dynamicTyping converts numbers and booleans, never dates, so a CSV's
 * "11/8/2016" stayed a string for its whole life. Measured across the demo
 * files: every one of them has a date column, and not one of them produced a
 * single Date object, so not one of them ever drew a trend over time.
 *
 * The hard part is the same as with numbers. "11/8/2016" is 11 August in most
 * of the world and 8 November in the United States, and no single cell can
 * settle it. A COLUMN usually can: somewhere in it is a day past the 12th,
 * and that one value fixes the order for every other. Where a column is
 * ambiguous end to end, the file's own CSV delimiter breaks the tie, exactly
 * as it does for the decimal mark.
 */

export type DateOrder = "month-first" | "day-first";

export interface ColumnDateFormat {
  order: DateOrder;
  /** Share of non-blank cells that parse under this decision, 0 to 1. */
  coverage: number;
  evidence: "unambiguous" | "delimiter" | "default" | "iso" | "month-name";
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** 2026-01-15, optionally with a time part. Unambiguous everywhere. */
const ISO = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s][\d:.]+)?\s*(?:Z|[+-]\d{2}:?\d{2})?\s*$/;
/** 11/8/2016, 15.01.2026, 1-17-24. Order unknown until the column decides. */
const NUMERIC = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\s*$/;
/** 31-MAR-2025, 31 March 2025. */
const DAY_MONTH_NAME = /^\s*(\d{1,2})[-/.\s]([A-Za-z]{3,})[-/.\s](\d{2,4})\s*$/;
/** Mar 31, 2025 / March 31 2025. */
const MONTH_NAME_DAY = /^\s*([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{2,4})\s*$/;

function fullYear(y: number): number {
  if (y >= 100) return y;
  // A two-digit year: the 20xx window, falling back to 19xx for the tail.
  // Business exports are overwhelmingly recent, so 70 is a safe hinge.
  return y >= 70 ? 1900 + y : 2000 + y;
}

function build(year: number, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(fullYear(year), month, day));
  // Rejects 31 February, which Date would otherwise roll into March.
  if (d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
  return d;
}

/** Reads one cell under an already-decided column order. */
export function parseDateLike(raw: unknown, order: DateOrder): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s === "") return null;

  const iso = ISO.exec(s);
  if (iso) return build(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const dmn = DAY_MONTH_NAME.exec(s);
  if (dmn) {
    const m = MONTHS[dmn[2].slice(0, 3).toLowerCase()];
    if (m !== undefined) return build(Number(dmn[3]), m, Number(dmn[1]));
  }

  const mnd = MONTH_NAME_DAY.exec(s);
  if (mnd) {
    const m = MONTHS[mnd[1].slice(0, 3).toLowerCase()];
    if (m !== undefined) return build(Number(mnd[3]), m, Number(mnd[2]));
  }

  const num = NUMERIC.exec(s);
  if (num) {
    const a = Number(num[1]);
    const b = Number(num[2]);
    const y = Number(num[3]);
    return order === "day-first" ? build(y, b - 1, a) : build(y, a - 1, b);
  }

  return null;
}

/**
 * Decides, for one column, which way round its numeric dates are written.
 *
 * A single cell with a first component above 12 proves day-first; a second
 * component above 12 proves month-first. One such cell settles the column.
 * Columns written entirely in ISO or with month names never need this.
 */
export function detectColumnDateFormat(
  values: unknown[],
  opts: { delimiter?: string } = {}
): ColumnDateFormat | null {
  const raws: string[] = [];
  let typed = 0;
  for (const v of values) {
    if (v instanceof Date) {
      typed++;
      continue;
    }
    if (typeof v !== "string" || v.trim() === "") continue;
    raws.push(v);
  }
  if (raws.length === 0) {
    return typed > 0 ? { order: "month-first", coverage: 1, evidence: "default" } : null;
  }

  let dayFirst = 0;
  let monthFirst = 0;
  let numeric = 0;
  for (const r of raws) {
    const m = NUMERIC.exec(r.trim());
    if (!m) continue;
    numeric++;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dayFirst++;
    else if (b > 12 && a <= 12) monthFirst++;
  }

  let order: DateOrder;
  let evidence: ColumnDateFormat["evidence"];
  if (numeric === 0) {
    order = "month-first";
    evidence = raws.some((r) => ISO.test(r.trim())) ? "iso" : "month-name";
  } else if (dayFirst !== monthFirst) {
    order = dayFirst > monthFirst ? "day-first" : "month-first";
    evidence = "unambiguous";
  } else if (opts.delimiter === ";") {
    // A semicolon-delimited file is a European export, and Europe writes the
    // day first. Same tie-breaker the number parser uses, for the same reason.
    order = "day-first";
    evidence = "delimiter";
  } else {
    order = "month-first";
    evidence = "default";
  }

  let ok = typed;
  for (const r of raws) if (parseDateLike(r, order) !== null) ok++;
  const coverage = ok / (raws.length + typed);
  if (coverage === 0) return null;

  return { order, coverage, evidence };
}
