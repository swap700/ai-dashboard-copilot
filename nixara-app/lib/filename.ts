/**
 * SECURITY FIX (M2 - response header injection).
 *
 * The export routes built the Content-Disposition filename from a caller-
 * supplied title, replacing only spaces. A title containing a double quote
 * could break out of the quoted filename and append header parameters, and
 * CR/LF could attempt header splitting. Node rejects some of these at the
 * socket level, but relying on that is relying on a downstream accident.
 *
 * sanitizeFilename returns a value that is always safe inside a quoted
 * Content-Disposition filename: lowercase, no quotes, no control characters,
 * no path separators, bounded length, never empty.
 */

const MAX_FILENAME_CHARS = 100;
const FALLBACK = "report";

export function sanitizeFilename(raw: string): string {
  const cleaned = (raw ?? "")
    .toLowerCase()
    .replace(/[\s -]+/g, "_")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/_{2,}/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "")
    .slice(0, MAX_FILENAME_CHARS);

  return cleaned.length > 0 ? cleaned : FALLBACK;
}
