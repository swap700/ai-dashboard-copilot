import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { Dataset, Row } from "./data-analysis";

/** Mirrors load_file: parses CSV or Excel into a row/column dataset. */
export async function loadFile(file: File): Promise<Dataset> {
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
        resolve({ rows: result.data, columns });
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

  return { rows, columns };
}
