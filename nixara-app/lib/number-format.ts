/**
 * Column-level number parsing: what a cell MEANS, decided once per column.
 *
 * Why this file exists. Until Oct 2026 every numeric string in the product
 * went through one line:
 *
 *     value.trim().replace(/[$,]/g, "")
 *
 * That deletes commas wherever they appear and understands nothing else. The
 * consequences were not edge cases:
 *
 *   "1.234,56"    a German/Spanish/Italian export      -> 1.23456   (1000x wrong, silently)
 *   "-$1,500.87"  Excel accounting format              -> null      (every loss row dropped)
 *   "(1,234.00)"  accounting negative                  -> null      (then the column reads as a CATEGORY)
 *   "45%"         a rate                               -> null
 *   "12 kg"       a measured quantity                  -> null
 *   "1 234,56"    a French export                      -> null
 *   "02134"       a postal code                        -> 2134      (identifier corrupted)
 *
 * The first of those is the worst thing the product could do: a revenue
 * column reported at a thousandth of its value, 100% numeric, with a quality
 * score of 100 next to it and nothing anywhere saying a word.
 *
 * The fix is not a longer regex. It is deciding the FORMAT PER COLUMN rather
 * than per cell. "1.234" alone is genuinely ambiguous: one-point-two-three-four
 * in Boston, one thousand two hundred thirty four in Berlin. No amount of
 * cleverness resolves it from that cell. But a column almost always contains
 * at least one unambiguous neighbour ("1.234,56", or "1,23", or "1.234.567"),
 * and that one neighbour settles the whole column. Where a column is
 * ambiguous end to end, the file's own CSV delimiter is the tie-breaker: a
 * semicolon-delimited file is a European export, because that is exactly why
 * Excel writes semicolons when the comma is the decimal mark.
 *
 * Nothing here guesses per cell. detectColumnNumberFormat() reads the whole
 * column, returns one decision plus the evidence for it, and
 * parseDecoratedNumber() then applies that decision uniformly. A column that
 * cannot be read as numbers at all returns null and stays text, which is the
 * honest answer rather than a partial conversion.
 */

/** Which character is the decimal mark. The other one is the group separator. */
export type DecimalStyle = "dot" | "comma";

/** Decorations seen in a column, for the quality panel to report. */
export interface NumberTraits {
  currency: boolean;
  percent: boolean;
  parens: boolean;
  grouped: boolean;
  unit: string | null;
}

export interface ColumnNumberFormat {
  style: DecimalStyle;
  /** Share of non-blank cells that parse under this decision, 0 to 1. */
  coverage: number;
  /** Share that parsed only because of a decoration the old parser rejected. */
  rescued: number;
  traits: NumberTraits;
  /** Why this style was chosen, for the runbook and the UI. */
  evidence: "unambiguous" | "grouping" | "delimiter" | "coverage" | "default";
}

export interface DetectOptions {
  /**
   * The CSV delimiter the file actually used. ";" is the signal that the file
   * came from a locale where "," is the decimal mark, which is the only
   * reason Excel ever writes semicolons.
   */
  delimiter?: string;
}

/** Cells that mean "no value" before any format question arises. */
function isBlank(raw: string): boolean {
  return raw.trim() === "";
}

/**
 * The formula-injection guard in file-parser.ts prefixes a cell with "'".
 * That prefix is a display concern and must not make a number unreadable --
 * it is exactly how "-1,500.87" used to become null.
 */
function stripGuard(s: string): string {
  return s.startsWith("'") ? s.slice(1) : s;
}

/**
 * Currency written as letters. Symbols are matched by Unicode property
 * instead, so this list only needs the alphabetic codes.
 */
const CURRENCY_WORDS =
  "USD|EUR|GBP|INR|JPY|CNY|CHF|CAD|AUD|NZD|SEK|NOK|DKK|PLN|CZK|HUF|ZAR|BRL|MXN|SGD|HKD|AED|SAR|Rs|R\\$|kr|z\\u0142|RMB";

const LEADING_CURRENCY = new RegExp(`^(?:\\p{Sc}|(?:${CURRENCY_WORDS})\\b\\.?)\\s*`, "iu");
const TRAILING_CURRENCY = new RegExp(`\\s*(?:\\p{Sc}|\\b(?:${CURRENCY_WORDS})\\.?)$`, "iu");
const LEADING_SIGN = /^([+-])\s*/;

/** Group separators that are not the decimal mark: space forms and the Swiss apostrophe. */
const NEUTRAL_GROUP = "[\\s\\u00A0\\u202F'\\u2019]";

const GRAMMAR: Record<DecimalStyle, RegExp> = {
  // 1,234,567.89 | 1 234 567.89 | 1234.89 | 1234 | 1.2e6
  dot: new RegExp(
    `^(?:\\d{1,3}(?:(?:,|${NEUTRAL_GROUP})\\d{3})+|\\d+)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?$`
  ),
  // 1.234.567,89 | 1 234 567,89 | 1234,89 | 1234
  comma: new RegExp(
    `^(?:\\d{1,3}(?:(?:\\.|${NEUTRAL_GROUP})\\d{3})+|\\d+)(?:,\\d+)?$`
  ),
};

/** A digit string with a meaningful leading zero: an id, not a quantity. */
const LEADING_ZERO_ID = /^0\d+$/;

/** The alphabetic tail of a measured value: "12 kg", "3.5hrs", "40 units". */
const TRAILING_UNIT = /^(.*?)\s*([A-Za-z°%µ][A-Za-z.\/²³]*)$/;

interface Peeled {
  /** The numeric body, decorations removed. */
  body: string;
  negative: boolean;
  percent: boolean;
  parens: boolean;
  currency: boolean;
  unit: string | null;
}

/**
 * Strips every decoration from a cell without deciding what the digits mean.
 * Sign and currency are peeled in a loop because real exports write both
 * orders: Excel's accounting format emits "-$1,500.87", some ERPs "$-1,500.87",
 * and SAP puts the sign at the end ("1500.87-").
 */
function peel(raw: string): Peeled {
  let s = stripGuard(raw.trim());
  let negative = false;
  let percent = false;
  let parens = false;
  let currency = false;
  let unit: string | null = null;

  const wrapped = /^\(\s*(.*?)\s*\)$/.exec(s);
  if (wrapped) {
    parens = true;
    negative = true;
    s = wrapped[1];
  }

  if (s.endsWith("%")) {
    percent = true;
    s = s.slice(0, -1).trim();
  }

  // Peel sign and currency in either order, repeatedly.
  for (let i = 0; i < 4; i++) {
    const sign = LEADING_SIGN.exec(s);
    if (sign) {
      if (sign[1] === "-") negative = !negative;
      s = s.slice(sign[0].length);
      continue;
    }
    const lead = LEADING_CURRENCY.exec(s);
    if (lead) {
      currency = true;
      s = s.slice(lead[0].length);
      continue;
    }
    const trail = TRAILING_CURRENCY.exec(s);
    if (trail && /\d/.test(s.slice(0, trail.index))) {
      currency = true;
      s = s.slice(0, trail.index);
      continue;
    }
    break;
  }

  // Trailing sign, after currency so "1,500.87-" and "1,500.87 EUR-" both work.
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }

  // A unit is only peeled when the remainder still looks like digits, so
  // "Q3 Actuals" is never mistaken for a number with a unit.
  const withUnit = TRAILING_UNIT.exec(s);
  if (withUnit && /\d$/.test(withUnit[1].trim())) {
    unit = withUnit[2];
    s = withUnit[1].trim();
  }

  return { body: s, negative, percent, parens, currency, unit };
}

/**
 * Reads one cell under an already-decided column format.
 *
 * `unit` is the unit agreed for the column: a cell carrying a DIFFERENT unit
 * is not a number in the same series, so it is rejected rather than silently
 * mixed in. "12 kg" and "12 lb" in one column is a data problem the quality
 * panel should report, not something to average.
 */
export function parseDecoratedNumber(
  raw: unknown,
  style: DecimalStyle,
  unit: string | null = null
): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  if (isBlank(raw)) return null;

  const p = peel(raw);
  if (p.body === "") return null;
  if (p.unit !== null && unit !== null && p.unit.toLowerCase() !== unit.toLowerCase()) return null;
  if (p.unit !== null && unit === null) return null;
  if (LEADING_ZERO_ID.test(p.body)) return null;
  if (!GRAMMAR[style].test(p.body)) return null;

  const groupSep = style === "dot" ? /[,\s  '’]/g : /[.\s  '’]/g;
  const normalized = p.body.replace(groupSep, "").replace(",", style === "comma" ? "." : "");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;

  const signed = p.negative ? -n : n;
  // A percent is stored as the fraction it denotes, matching how a ratio
  // column that arrives already numeric (0.3458) is stored. Keeping the two
  // on one scale is what lets smartAgg and looksLikeProportion stay coherent.
  return p.percent ? signed / 100 : signed;
}

/** The old behaviour, for measuring how many cells the new parser rescues. */
function legacyParse(raw: string): number | null {
  const cleaned = stripGuard(raw.trim()).replace(/[$,]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

interface Vote {
  dot: number;
  comma: number;
  evidence: ColumnNumberFormat["evidence"];
}

/**
 * Which style a single cell is evidence for, if any.
 *
 * Three kinds of proof, in descending strength:
 *  - both separators present: the LAST one is the decimal mark ("1.234,56")
 *  - one separator, in a group of other than 3 digits: it must be the decimal
 *    mark, because a thousands group is always exactly 3 ("1,23" / "1.2345")
 *  - the same separator more than once: it must be the group separator,
 *    which makes the OTHER one the decimal mark ("1.234.567")
 *
 * A cell like "1.234" is evidence for nothing and is deliberately silent.
 */
function voteFor(body: string): DecimalStyle | null {
  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) return lastDot > lastComma ? "dot" : "comma";

  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;
  if (dots > 1) return "comma";
  if (commas > 1) return "dot";

  if (dots === 1) {
    const tail = body.length - lastDot - 1;
    if (tail !== 3) return "dot";
    return null;
  }
  if (commas === 1) {
    const tail = body.length - lastComma - 1;
    if (tail !== 3) return "comma";
    return null;
  }
  return null;
}

function coverageUnder(raws: string[], style: DecimalStyle, unit: string | null): number {
  if (raws.length === 0) return 0;
  let ok = 0;
  for (const r of raws) if (parseDecoratedNumber(r, style, unit) !== null) ok++;
  return ok / raws.length;
}

/**
 * Decides, for one column, whether its cells are numbers and in which format.
 *
 * Returns null when the column should stay text: no usable coverage, or the
 * cells are leading-zero identifiers, which are digits that are not
 * quantities and must never be converted (a postal code of 02134 turning into
 * 2134 is both a wrong value and a column that then gets charted).
 */
export function detectColumnNumberFormat(
  values: unknown[],
  opts: DetectOptions = {}
): ColumnNumberFormat | null {
  const raws: string[] = [];
  let alreadyNumeric = 0;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) {
      alreadyNumeric++;
      continue;
    }
    if (typeof v !== "string" || isBlank(v)) continue;
    raws.push(v);
  }
  if (raws.length === 0) {
    return alreadyNumeric > 0
      ? {
          style: "dot",
          coverage: 1,
          rescued: 0,
          traits: { currency: false, percent: false, parens: false, grouped: false, unit: null },
          evidence: "default",
        }
      : null;
  }

  // Leading-zero identifiers: decided before anything else, because these are
  // the one case where a column of pure digits must NOT become numbers.
  let leadingZero = 0;
  for (const r of raws) {
    const body = peel(r).body;
    if (LEADING_ZERO_ID.test(body)) leadingZero++;
  }
  if (leadingZero / raws.length >= 0.1) return null;

  // A unit is only accepted when the column agrees on it. A single "12 kg"
  // among plain numbers is a stray, not a series.
  const unitCounts = new Map<string, number>();
  const decorated = { currency: false, percent: false, parens: false };
  for (const r of raws) {
    const p = peel(r);
    if (p.unit) unitCounts.set(p.unit.toLowerCase(), (unitCounts.get(p.unit.toLowerCase()) ?? 0) + 1);
    if (p.currency) decorated.currency = true;
    if (p.percent) decorated.percent = true;
    if (p.parens) decorated.parens = true;
  }
  let unit: string | null = null;
  for (const [u, n] of unitCounts) {
    if (n / raws.length >= 0.8) unit = u;
  }

  const vote: Vote = { dot: 0, comma: 0, evidence: "default" };
  let grouped = false;
  for (const r of raws) {
    const body = peel(r).body;
    if (/[.,\s  '’]/.test(body)) grouped = true;
    const v = voteFor(body);
    if (v === "dot") vote.dot++;
    else if (v === "comma") vote.comma++;
  }

  let style: DecimalStyle;
  let evidence: ColumnNumberFormat["evidence"];
  if (vote.dot !== vote.comma) {
    style = vote.dot > vote.comma ? "dot" : "comma";
    evidence = "unambiguous";
  } else if (opts.delimiter === ";") {
    style = "comma";
    evidence = "delimiter";
  } else {
    style = "dot";
    evidence = "default";
  }

  // Safety net: if the other style reads materially more of the column, the
  // vote was wrong or absent. Coverage is the ground truth, not the heuristic.
  const chosen = coverageUnder(raws, style, unit);
  const other: DecimalStyle = style === "dot" ? "comma" : "dot";
  const alt = coverageUnder(raws, other, unit);
  if (alt > chosen + 0.1) {
    style = other;
    evidence = "coverage";
  }

  const coverageStrings = coverageUnder(raws, style, unit);
  const total = raws.length + alreadyNumeric;
  const coverage = (coverageStrings * raws.length + alreadyNumeric) / total;
  // A column where nothing at all reads as a number is a text column, and
  // saying so here keeps the contract honest: a caller that gets a format
  // back can rely on at least some of the column being numeric.
  if (coverage === 0) return null;

  let rescued = 0;
  for (const r of raws) {
    if (parseDecoratedNumber(r, style, unit) !== null && legacyParse(r) === null) rescued++;
  }

  return {
    style,
    coverage,
    rescued: rescued / total,
    traits: { ...decorated, grouped, unit },
    evidence,
  };
}
