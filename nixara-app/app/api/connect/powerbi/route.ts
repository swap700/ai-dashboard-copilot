import { NextRequest, NextResponse } from "next/server";
import { safeUpstreamMessage } from "@/lib/url-guard";
import { toDaxIdentifier } from "@/lib/dax";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MAX_SECRET_CHARS = 500;

/**
 * SECURITY FIX (H2 — DAX injection): fetchTable used to interpolate the
 * caller's `tableName` directly into `EVALUATE ${tableName}`. The value was
 * never checked against the tables actually present in the dataset, so any
 * caller could run arbitrary DAX against the dataset — reading tables and
 * columns the connector flow never offered them.
 *
 * The fix has two halves, and both matter:
 *   1. The table name must appear verbatim in a table list fetched
 *      server-side, in the same request, from the same dataset. An allowlist
 *      derived from the upstream itself, not from anything the caller sent.
 *   2. The name is then emitted as a properly escaped DAX quoted identifier
 *      rather than pasted in raw. (This also fixes a plain bug: table names
 *      containing spaces never worked before.)
 *
 * SECURITY FIX (H2b — API path injection): tenantId / workspaceId / datasetId
 * were interpolated into upstream URL paths unvalidated, so a value like
 * "../../other" could walk the request to a different Power BI or Entra ID
 * endpoint. All four are GUIDs in every real deployment, so they are now
 * validated as such and rejected otherwise.
 */

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

class UpstreamError extends Error {
  constructor(readonly status: number | undefined, readonly detail: string, readonly context: string) {
    super(detail);
    this.name = "UpstreamError";
  }
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), redirect: "error" });
}

// ── Azure AD OAuth2 → Power BI token ─────────────────────────────────────────
async function getPowerBIToken(
  tenantId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://analysis.windows.net/powerbi/api/.default",
  });

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new UpstreamError(
      res.status,
      String(json.error_description ?? json.error ?? "no access_token in response"),
      "authenticate"
    );
  }

  return json.access_token as string;
}

// ── List tables in a Power BI dataset ─────────────────────────────────────────
async function listTables(
  token: string,
  workspaceId: string,
  datasetId: string
): Promise<string[]> {
  const url =
    `https://api.powerbi.com/v1.0/myorg/groups/${encodeURIComponent(workspaceId)}` +
    `/datasets/${encodeURIComponent(datasetId)}/tables`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (!res.ok) {
    throw new UpstreamError(res.status, await res.text().catch(() => ""), "list tables");
  }

  const json = await res.json();
  const tables = (json.value as { name: string }[]) ?? [];
  return tables.map((t) => t.name).filter((n): n is string => typeof n === "string");
}

// ── Fetch a table via DAX query → CSV text ────────────────────────────────────
async function fetchTable(
  token: string,
  workspaceId: string,
  datasetId: string,
  tableName: string
): Promise<string> {
  // Allowlist check — the name must be a table this dataset actually exposes.
  const available = await listTables(token, workspaceId, datasetId);
  if (!available.includes(tableName)) {
    throw new UpstreamError(404, "table not in dataset", `fetch table "${tableName}"`);
  }

  const url =
    `https://api.powerbi.com/v1.0/myorg/groups/${encodeURIComponent(workspaceId)}` +
    `/datasets/${encodeURIComponent(datasetId)}/executeQueries`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      queries: [{ query: `EVALUATE ${toDaxIdentifier(tableName)}` }],
      serializerSettings: { includeNulls: true },
    }),
  });

  if (!res.ok) {
    throw new UpstreamError(res.status, await res.text().catch(() => ""), "run table query");
  }

  const json = await res.json();
  const rows: Record<string, unknown>[] = json.results?.[0]?.tables?.[0]?.rows ?? [];

  if (rows.length === 0) return "";

  // Strip "TableName[ColumnName]" prefix → just "ColumnName"
  const rawKeys = Object.keys(rows[0]);
  const cleanKeys = rawKeys.map((k) => {
    const match = k.match(/\[(.+)\]$/);
    return match ? match[1] : k;
  });

  const header = cleanKeys.map((k) => `"${k.replace(/"/g, '""')}"`).join(",");
  const dataLines = rows.map((row) => {
    const vals = rawKeys.map((rk) => {
      const v = row[rk];
      if (v === null || v === undefined) return "";
      if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
      return String(v);
    });
    return vals.join(",");
  });

  const csv = [header, ...dataLines].join("\n");
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) {
    throw new UpstreamError(413, "table data too large", `fetch table "${tableName}"`);
  }
  return csv;
}

// ── Route handler ─────────────────────────────────────────────────────────────
interface BaseBody {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  workspaceId: string;
  datasetId: string;
}

interface ListBody extends BaseBody {
  action: "list-tables";
}

interface FetchBody extends BaseBody {
  action: "fetch-table";
  tableName: string;
}

type Body = ListBody | FetchBody;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { tenantId, clientId, clientSecret, workspaceId, datasetId } = body;

  if (!tenantId || !clientId || !clientSecret || !workspaceId || !datasetId) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  // GUID-shape validation — also blocks path traversal into other API routes.
  for (const [label, value] of [
    ["Tenant ID", tenantId],
    ["Client ID", clientId],
    ["Workspace ID", workspaceId],
    ["Dataset ID", datasetId],
  ] as const) {
    if (typeof value !== "string" || !GUID_RE.test(value.trim())) {
      return NextResponse.json(
        { error: `${label} must be a valid GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).` },
        { status: 400 }
      );
    }
  }
  if (typeof clientSecret !== "string" || clientSecret.length > MAX_SECRET_CHARS) {
    return NextResponse.json({ error: "Client Secret is not in the expected format." }, { status: 400 });
  }

  const tenant = tenantId.trim();
  const workspace = workspaceId.trim();
  const dataset = datasetId.trim();

  try {
    const token = await getPowerBIToken(tenant, clientId.trim(), clientSecret);

    if (body.action === "list-tables") {
      return NextResponse.json({ tables: await listTables(token, workspace, dataset) });
    }

    if (body.action === "fetch-table") {
      if (typeof body.tableName !== "string" || !body.tableName || body.tableName.length > 256) {
        return NextResponse.json({ error: "tableName is required." }, { status: 400 });
      }
      const csvText = await fetchTable(token, workspace, dataset, body.tableName);
      return NextResponse.json({ csvText, source: `Power BI · ${body.tableName}` });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return NextResponse.json(
        { error: safeUpstreamMessage("Power BI", err.status, err.detail, err.context) },
        { status: 502 }
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: safeUpstreamMessage("Power BI", undefined, detail, "connection") },
      { status: 502 }
    );
  }
}
