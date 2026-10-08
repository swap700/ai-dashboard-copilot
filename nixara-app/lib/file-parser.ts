import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { Dataset, Row } from "./data-analysis";

// Fix M2: enforce file size limit before loading into memory
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * CSV READ CHECKS.
 *
 * PapaParse does not throw on a malformed file. It returns whatever it could
 * read and lists the problems in `result.errors`, which this module used to
 * ignore. The dangerous case is a value that OPENS with a quote and never
 * closes: the parser keeps waiting for the closing quote and swallows the
 * entire rest of the file into that one cell, so a 1,000-row file with one bad
 * quote at row 300 came back as 300 rows, with no warning, and every chart
 * and report was built on the 300.
 *
 *   - Unclosed quote (MissingQuotes): rows are lost, so refuse the file and
 *     say where.
 *   - Rows with the wrong number of columns (TooFewFields / TooManyFields):
 *     every row is kept, so read the file but warn.
 */
interface CsvInspection {
  unclosedQuoteRow: number | null;
  mismatchedRows: number;
  strayQuoteValues: number;
}

function inspectCsvResult(result: Papa.ParseResult<Row>): CsvInspection {
  let unclosedQuoteRow: number | null = null;
  let mismatchedRows = 0;
  let strayQuoteValues = 0;
  for (const err of result.errors) {
    if (err.code === "MissingQuotes") {
      if (unclosedQuoteRow === null) unclosedQuoteRow = err.row ?? result.data.length;
    } else if (err.code === "TooFewFields" || err.code === "TooManyFields") {
      mismatchedRows++;
    } else if (err.code === "InvalidQuotes") {
      strayQuoteValues++;
    }
  }
  // A swallowed remainder also reports one TooFewFields on the last row it
  // read; that is a symptom of the unclosed quote, not a separate problem.
  if (unclosedQuoteRow !== null) mismatchedRows = 0;
  return { unclosedQuoteRow, mismatchedRows, strayQuoteValues };
}

/** Approximate number of data lines in raw CSV text (line breaks minus the header). Line breaks inside quoted cells are counted, so this is an estimate. */
function estimateDataLines(text: string): number {
  if (!text) return 0;
  let breaks = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) breaks++;
  const lines = text.endsWith("\n") ? breaks : breaks + 1;
  return Math.max(0, lines - 1);
}

function unclosedQuoteMessage(row: number, rowsRead: number, approxLines: number): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const scale = approxLines > rowsRead ? ` (${fmt(rowsRead)} of about ${fmt(approxLines)} rows were readable)` : "";
  return (
    `We could not read this file safely. A quoted value opens near row ${fmt(row)} and never closes, ` +
    `so everything after it would be read as a single cell${scale}. ` +
    `Open the file, fix or remove the stray quote near that row, then upload it again.`
  );
}

function csvWarnings(insp: CsvInspection, columnCount: number): string[] {
  const out: string[] = [];
  const n = insp.mismatchedRows;
  if (n > 0) {
    out.push(
      `${n.toLocaleString("en-US")} row${n === 1 ? " does" : "s do"} not have ${columnCount} columns like the header. ` +
        `${n === 1 ? "It was" : "They were"} kept, but values in ${n === 1 ? "that row" : "those rows"} may be misaligned, ` +
        `so figures built on ${n === 1 ? "it" : "them"} could be off.`
    );
  }
  const q = insp.strayQuoteValues;
  if (q > 0) {
    out.push(`${q.toLocaleString("en-US")} value${q === 1 ? " contains" : "s contain"} stray quote marks and ${q === 1 ? "was" : "were"} read as written.`);
  }
  return out;
}

/**
 * SECURITY FIX (2026-08): CSV/Excel formula injection.
 *
 * A cell value that starts with =, +, -, @, tab, or CR is interpreted as a
 * formula by Excel/Sheets/LibreOffice if that value is ever re-opened in a
 * spreadsheet (including a future CSV/XLSX export feature, or a user who
 * copy-pastes a report table back into Excel). Classic payloads look like
 * `=cmd|'/c calc'!A1` or `=HYPERLINK("http://evil","click")`. We neutralize
 * this once, at ingestion, by prefixing a straight quote — spreadsheet apps
 * then render it as inert text instead of evaluating it. Applied to every
 * string cell AND header name from both the CSV and Excel parse paths, so
 * every downstream consumer (charts, the OpenAI prompt, docx/pdf export)
 * automatically inherits the sanitized value. Numbers/booleans pass through
 * untouched.
 */
const FORMULA_TRIGGER_CHARS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * BUG FIX (2026-09): a plain negative (or "+"-prefixed) number starts with a
 * formula-trigger character too, and this function ran on it right along
 * with real formula text. PapaParse's dynamicTyping converts a numeric cell
 * to an actual `number` before this ever runs, but only when the string has
 * no thousands separator -- "-670.58" becomes a number and skips this
 * function entirely (see the `typeof value !== "string"` guard above), while
 * "-1,500.87" fails Papa's stricter numeric regex and arrives here as a live
 * string. Every value like that -- negative and >= 1,000 in magnitude -- was
 * getting a `'` prepended, corrupting "-1,500.87" into "'-1,500.87": a value
 * cleanDataset's toNumberOrNull() can no longer parse, so it silently became
 * `null` ("missing data") and was dropped from every sum. On one real report
 * this alone accounted for a five-figure swing in a region's reported total
 * profit and a false "N missing values" data-quality flag on a column that
 * had zero actual blanks.
 *
 * A cell that reads as a clean signed number (optionally with thousands
 * separators, a decimal, and/or a leading currency symbol) is never a
 * spreadsheet formula -- formula injection needs actual formula syntax after
 * the trigger character (a function call, a second operator, a cell
 * reference), which a plain number never has. So a value is only sanitized
 * when it starts with a trigger character AND does NOT parse as a plain
 * number.
 */
/**
 * WIDENED (2026-10). The old pattern required the currency symbol BEFORE the
 * sign, so "-$1,500.87" -- which is exactly what Excel's accounting format
 * emits -- failed it, got the guard prefix, and then failed to parse. Every
 * loss row in such a file became null, and on a Profit column where all the
 * negatives are written that way the whole column dropped below the metric
 * coverage bar and the report was told there was nothing to measure.
 *
 * The grammar now covers what real exports actually write: either sign order,
 * parenthesised negatives, a trailing sign, European grouping and decimals,
 * space grouping, a percent sign, and a trailing unit. It stays strict about
 * the one thing that matters for the guard: formula injection needs real
 * formula syntax after the trigger character -- a function call, a second
 * operator, a cell reference -- and none of these shapes admit any of that.
 */
const PLAIN_NUMBER =
  /^\(?\s*(?:[+-]\s*)?(?:\p{Sc}\s*)?(?:[+-]\s*)?(?:\d{1,3}(?:[,.\s\u00A0\u202F']\d{3})+|\d+)(?:[.,]\d+)?(?:[eE][+-]?\d+)?\s*(?:\p{Sc})?\s*%?\s*-?\s*\)?$/u;

function sanitizeCell<T>(value: T): T {
  if (typeof value !== "string") return value;
  if (value.length === 0) return value;
  if (FORMULA_TRIGGER_CHARS.includes(value[0]) && !PLAIN_NUMBER.test(value.trim())) {
    return ("'" + value) as unknown as T;
  }
  return value;
}

function sanitizeRow(row: Row): Row {
  const clean: Row = {};
  for (const [key, value] of Object.entries(row)) {
    clean[sanitizeCell(key)] = sanitizeCell(value);
  }
  return clean;
}

function sanitizeDataset(dataset: Dataset): Dataset {
  // Spread first so optional fields (warnings, sourceDelimiter) survive.
  return {
    ...dataset,
    columns: dataset.columns.map((c) => sanitizeCell(c)),
    rows: dataset.rows.map(sanitizeRow),
  };
}

/**
 * DELIBERATELY OFF (2026-10). PapaParse's dynamicTyping decides what a cell
 * means one cell at a time, with no knowledge of the column, and it does so
 * before any of our code can see the raw text. Two faults follow, and neither
 * is fixable downstream because the original string is already gone:
 *
 *   "1.200"  a German one thousand two hundred  ->  1.2    (1000x wrong, silently)
 *   "02134"  a postal code                      ->  2134   (identifier corrupted)
 *
 * It also typed cells individually WITHIN a column, which is where the
 * coaster_db chart came from: a date column where 16% of cells happened to
 * parse as Excel serial numbers passed as a metric and was averaged over
 * those cells alone.
 *
 * Typing is now done once per column by cleanDataset(), which reads the whole
 * column before deciding anything (see number-format.ts). Every upload path,
 * file, Tableau and Power BI, goes through cleanDataset, so this is one place
 * deciding types instead of two places disagreeing.
 */
const DYNAMIC_TYPING = false;

/** Parse a raw CSV string (returned from Tableau / Power BI API routes). */
export function parseCsvText(text: string): Dataset {
  const result = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: DYNAMIC_TYPING,
  });
  const columns = result.meta.fields ?? [];
  const insp = inspectCsvResult(result);
  if (insp.unclosedQuoteRow !== null) {
    throw new Error(unclosedQuoteMessage(insp.unclosedQuoteRow, result.data.length, estimateDataLines(text)));
  }
  const dataset = sanitizeDataset({
    rows: result.data,
    columns,
    // Carried so cleanDataset can break an ambiguous number format: ";" means
    // the file came from a locale where "," is the decimal mark.
    sourceDelimiter: result.meta.delimiter,
  });
  const warnings = csvWarnings(insp, columns.length);
  return warnings.length > 0 ? { ...dataset, warnings } : dataset;
}

/** Mirrors load_file: parses CSV or Excel into a row/column dataset. */
export async function loadFile(file: File): Promise<Dataset> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB) — maximum allowed size is 20 MB.`
    );
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return parseCsv(file);
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseExcel(file);
  throw new Error("Unsupported file type — please upload a CSV or Excel file.");
}

function parseCsv(file: File): Promise<Dataset> {
  return new Promise((resolve, reject) => {
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: DYNAMIC_TYPING,
      complete: (result) => {
        const columns = result.meta.fields ?? [];
        const insp = inspectCsvResult(result);
        if (insp.unclosedQuoteRow !== null) {
          const row = insp.unclosedQuoteRow;
          const rowsRead = result.data.length;
          // Only on this failure path is the file read a second time, to
          // estimate how many rows were lost. It is already under the size cap.
          file.text().then(
            (text) => reject(new Error(unclosedQuoteMessage(row, rowsRead, estimateDataLines(text)))),
            () => reject(new Error(unclosedQuoteMessage(row, rowsRead, 0)))
          );
          return;
        }
        const dataset = sanitizeDataset({
          rows: result.data,
          columns,
          sourceDelimiter: result.meta.delimiter,
        });
        const warnings = csvWarnings(insp, columns.length);
        resolve(warnings.length > 0 ? { ...dataset, warnings } : dataset);
      },
      error: (err: Error) => reject(err),
    });
  });
}

async function parseExcel(file: File): Promise<Dataset> {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], columns: [] };

  const headerRow = sheet.getRow(1);
  const columns: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    columns[colNumber - 1] = String(cell.value ?? `col_${colNumber}`);
  });

  const rows: Row[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Row = {};
    columns.forEach((col, idx) => {
      const cell = row.getCell(idx + 1);
      obj[col] = cell.value instanceof Object && "result" in cell.value
        ? (cell.value as { result: unknown }).result
        : cell.value;
    });
    rows.push(obj);
  });

  return sanitizeDataset({ rows, columns });
}
