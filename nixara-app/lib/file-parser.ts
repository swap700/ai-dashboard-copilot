import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { Dataset, Row } from "./data-analysis";

// Fix M2: enforce file size limit before loading into memory
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

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

function sanitizeCell<T>(value: T): T {
  if (typeof value !== "string") return value;
  if (value.length === 0) return value;
  if (FORMULA_TRIGGER_CHARS.includes(value[0])) {
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
  return {
    columns: dataset.columns.map((c) => sanitizeCell(c)),
    rows: dataset.rows.map(sanitizeRow),
  };
}

/** Parse a raw CSV string (returned from Tableau / Power BI API routes). */
export function parseCsvText(text: string): Dataset {
  const result = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });
  return sanitizeDataset({ rows: result.data, columns: result.meta.fields ?? [] });
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
      dynamicTyping: true,
      complete: (result) => {
        const columns = result.meta.fields ?? [];
        resolve(sanitizeDataset({ rows: result.data, columns }));
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
