import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// ── Azure AD OAuth2 → Power BI token ─────────────────────────────────────────
async function getPowerBIToken(
  tenantId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://analysis.windows.net/powerbi/api/.default",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Power BI auth failed: ${json.error_description ?? json.error ?? "Unknown error"}`
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
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/tables`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list Power BI tables (${res.status}): ${text}`);
  }

  const json = await res.json();
  const tables = (json.value as { name: string }[]) ?? [];
  return tables.map((t) => t.name);
}

// ── Fetch a table via DAX query → CSV text ────────────────────────────────────
async function fetchTable(
  token: string,
  workspaceId: string,
  datasetId: string,
  tableName: string
): Promise<string> {
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      queries: [{ query: `EVALUATE ${tableName}` }],
      serializerSettings: { includeNulls: true },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Power BI query failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const rows: Record<string, unknown>[] =
    json.results?.[0]?.tables?.[0]?.rows ?? [];

  if (rows.length === 0) return "";

  // Strip "TableName[ColumnName]" prefix → just "ColumnName"
  const rawKeys = Object.keys(rows[0]);
  const cleanKeys = rawKeys.map((k) => {
    const match = k.match(/\[(.+)\]$/);
    return match ? match[1] : k;
  });

  // Build CSV string
  const header = cleanKeys.map((k) => `"${k}"`).join(",");
  const dataLines = rows.map((row) => {
    const vals = rawKeys.map((rk) => {
      const v = row[rk];
      if (v === null || v === undefined) return "";
      if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
      return String(v);
    });
    return vals.join(",");
  });

  return [header, ...dataLines].join("\n");
}

// ── Route handler ─────────────────────────────────────────────────────────────
interface ListBody {
  action: "list-tables";
  tenantId: string;
  clientId: string;
  clientSecret: string;
  workspaceId: string;
  datasetId: string;
}

interface FetchBody extends ListBody {
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

  try {
    const token = await getPowerBIToken(tenantId, clientId, clientSecret);

    if (body.action === "list-tables") {
      const tables = await listTables(token, workspaceId, datasetId);
      return NextResponse.json({ tables });
    }

    if (body.action === "fetch-table") {
      if (!body.tableName) {
        return NextResponse.json({ error: "tableName is required." }, { status: 400 });
      }
      const csvText = await fetchTable(token, workspaceId, datasetId, body.tableName);
      return NextResponse.json({
        csvText,
        source: `Power BI · ${body.tableName}`,
      });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Power BI connection failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
