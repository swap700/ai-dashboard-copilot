import { sanitizeFilename } from "./filename";

/**
 * Shared validation for the two export routes.
 *
 * SECURITY FIX (M2). Both routes previously did `await req.json()` with no
 * try/catch and no bounds, then interpolated the caller's title straight into
 * a Content-Disposition header. Three problems in one:
 *
 *   - a malformed body threw and surfaced as an unhandled 500
 *   - the routes are unauthenticated arbitrary-text document generators, with
 *     no cap on input size, so a large body turned into CPU and memory in a
 *     serverless function on someone else's budget
 *   - a title containing a double quote could break out of the quoted
 *     filename; CR/LF could attempt header splitting
 *
 * Everything here is caller-controlled and none of it is trusted.
 */

export const MAX_REPORT_TEXT_CHARS = 20_000;
export const MAX_TITLE_CHARS = 120;
export const MAX_CONTEXT_CHARS = 300;

export interface ExportPayload {
  reportText: string;
  title: string;
  who: string;
  decision: string;
  timeframe: string;
  /** Safe to place inside a quoted Content-Disposition filename. */
  filenameStem: string;
}

export type ExportParseResult =
  | { ok: true; payload: ExportPayload }
  | { ok: false; status: number; error: string };

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function parseExportPayload(req: Request): Promise<ExportParseResult> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, status: 400, error: "Invalid request body." };
  }
  if (!raw || typeof raw !== "object") {
    return { ok: false, status: 400, error: "Invalid request body." };
  }

  const body = raw as Record<string, unknown>;
  const reportText = asString(body.reportText);
  const title = asString(body.title);

  if (!reportText.trim()) {
    return { ok: false, status: 400, error: "Missing report text." };
  }
  if (reportText.length > MAX_REPORT_TEXT_CHARS) {
    return { ok: false, status: 413, error: "Report is too large to export." };
  }
  if (title.length > MAX_TITLE_CHARS) {
    return { ok: false, status: 413, error: "Title is too long." };
  }

  const who = asString(body.who).slice(0, MAX_CONTEXT_CHARS);
  const decision = asString(body.decision).slice(0, MAX_CONTEXT_CHARS);
  const timeframe = asString(body.timeframe).slice(0, MAX_CONTEXT_CHARS);

  return {
    ok: true,
    payload: {
      reportText,
      title: title.trim() || "Report",
      who,
      decision,
      timeframe,
      filenameStem: sanitizeFilename(title),
    },
  };
}
