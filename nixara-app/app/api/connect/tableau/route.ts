import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const API_VERSION = "3.22";

interface Body {
  server: string;
  siteId: string;
  tokenName: string;
  tokenSecret: string;
  viewName: string;
}

// ── Step 1: Sign in with Personal Access Token ────────────────────────────────
async function signIn(
  server: string,
  siteId: string,
  tokenName: string,
  tokenSecret: string
): Promise<{ token: string; resolvedSiteId: string }> {
  const url = `${server}/api/${API_VERSION}/auth/signin`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      credentials: {
        personalAccessTokenName: tokenName,
        personalAccessTokenSecret: tokenSecret,
        site: { contentUrl: siteId },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tableau auth failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return {
    token: json.credentials?.token,
    resolvedSiteId: json.credentials?.site?.id,
  };
}

// ── Step 2: Find a view by name ──────────────────────────────────────────────
async function findViewId(
  server: string,
  token: string,
  resolvedSiteId: string,
  viewName: string
): Promise<string> {
  // Fetch up to 500 views — paginate if needed
  const url = `${server}/api/${API_VERSION}/sites/${resolvedSiteId}/views?pageSize=500&fields=id,name`;
  const res = await fetch(url, {
    headers: { "X-Tableau-Auth": token, Accept: "application/json" },
  });

  if (!res.ok) throw new Error(`Failed to list views (${res.status})`);

  const json = await res.json();
  const views: { id: string; name: string }[] = json.views?.view ?? [];

  const match = views.find((v) => v.name.toLowerCase() === viewName.toLowerCase());
  if (!match) {
    const available = views.map((v) => v.name).join(", ");
    throw new Error(
      `View "${viewName}" not found. Available views: ${available || "(none returned)"}`
    );
  }
  return match.id;
}

// ── Step 3: Download view as CSV ─────────────────────────────────────────────
async function fetchViewCsv(
  server: string,
  token: string,
  resolvedSiteId: string,
  viewId: string
): Promise<string> {
  const url = `${server}/api/${API_VERSION}/sites/${resolvedSiteId}/views/${viewId}/data.csv?maxAge=0`;
  const res = await fetch(url, {
    headers: { "X-Tableau-Auth": token },
  });

  if (!res.ok) throw new Error(`Failed to fetch view data (${res.status})`);

  // Cap at 10 MB
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > 10 * 1024 * 1024) {
    throw new Error("View data exceeds 10 MB — use a filtered view or smaller dataset.");
  }

  return new TextDecoder().decode(buffer);
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { server, siteId, tokenName, tokenSecret, viewName } = body;

  if (!server || !tokenName || !tokenSecret || !viewName) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  // Normalise server URL (remove trailing slash)
  const serverUrl = server.replace(/\/+$/, "");

  try {
    const { token, resolvedSiteId } = await signIn(serverUrl, siteId ?? "", tokenName, tokenSecret);
    const viewId = await findViewId(serverUrl, token, resolvedSiteId, viewName);
    const csvText = await fetchViewCsv(serverUrl, token, resolvedSiteId, viewId);

    return NextResponse.json({
      csvText,
      source: `Tableau · ${viewName}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tableau connection failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
