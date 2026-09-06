import { NextRequest, NextResponse } from "next/server";
import { assertSafeUpstreamUrl, safeUpstreamMessage, UnsafeUrlError } from "@/lib/url-guard";

export const runtime = "nodejs";

const API_VERSION = "3.22";
const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MAX_FIELD_CHARS = 500;

/**
 * SECURITY FIX (H1 — SSRF): every request below is built from `origin`, the
 * validated origin returned by assertSafeUpstreamUrl, never from the raw
 * user-supplied string. Any path, query, or credentials the caller tried to
 * smuggle in the `server` field are discarded by that parse. Upstream response
 * bodies are never echoed back to the caller — see safeUpstreamMessage.
 */

interface Body {
  server: string;
  siteId: string;
  tokenName: string;
  tokenSecret: string;
  viewName: string;
}

class UpstreamError extends Error {
  constructor(readonly status: number | undefined, readonly detail: string, readonly context: string) {
    super(detail);
    this.name = "UpstreamError";
  }
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), redirect: "error" });
}

// ── Step 1: Sign in with Personal Access Token ────────────────────────────────
async function signIn(
  origin: string,
  siteId: string,
  tokenName: string,
  tokenSecret: string
): Promise<{ token: string; resolvedSiteId: string }> {
  const res = await fetchWithTimeout(`${origin}/api/${API_VERSION}/auth/signin`, {
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
    throw new UpstreamError(res.status, await res.text().catch(() => ""), "sign-in");
  }

  const json = await res.json();
  const token = json.credentials?.token;
  const resolvedSiteId = json.credentials?.site?.id;
  if (!token || !resolvedSiteId) {
    throw new UpstreamError(res.status, "sign-in response missing token or site id", "sign-in");
  }
  return { token, resolvedSiteId };
}

// ── Step 2: Find a view by name ──────────────────────────────────────────────
async function findViewId(
  origin: string,
  token: string,
  resolvedSiteId: string,
  viewName: string
): Promise<string> {
  const url =
    `${origin}/api/${API_VERSION}/sites/${encodeURIComponent(resolvedSiteId)}` +
    `/views?pageSize=500&fields=id,name`;
  const res = await fetchWithTimeout(url, {
    headers: { "X-Tableau-Auth": token, Accept: "application/json" },
  });

  if (!res.ok) {
    throw new UpstreamError(res.status, await res.text().catch(() => ""), "list views");
  }

  const json = await res.json();
  const views: { id: string; name: string }[] = json.views?.view ?? [];

  const match = views.find((v) => v.name.toLowerCase() === viewName.toLowerCase());
  if (!match) {
    // Safe to name these back: they are views on the caller's own authenticated site.
    const available = views.slice(0, 50).map((v) => v.name).join(", ");
    throw new UpstreamError(
      404,
      `view not found`,
      `find view "${viewName}"${available ? ` (available: ${available})` : ""}`
    );
  }
  return match.id;
}

// ── Step 3: Download view as CSV ─────────────────────────────────────────────
async function fetchViewCsv(
  origin: string,
  token: string,
  resolvedSiteId: string,
  viewId: string
): Promise<string> {
  const url =
    `${origin}/api/${API_VERSION}/sites/${encodeURIComponent(resolvedSiteId)}` +
    `/views/${encodeURIComponent(viewId)}/data.csv?maxAge=0`;
  const res = await fetchWithTimeout(url, { headers: { "X-Tableau-Auth": token } });

  if (!res.ok) {
    throw new UpstreamError(res.status, await res.text().catch(() => ""), "download view data");
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_CSV_BYTES) {
    throw new UpstreamError(413, "view data too large", "download view data");
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
  for (const field of [server, siteId ?? "", tokenName, tokenSecret, viewName]) {
    if (typeof field !== "string" || field.length > MAX_FIELD_CHARS) {
      return NextResponse.json(
        { error: "One or more fields exceed the maximum allowed length." },
        { status: 413 }
      );
    }
  }

  // ── SSRF gate — must pass before any outbound request is made ────────────
  let origin: string;
  try {
    origin = (await assertSafeUpstreamUrl(server.trim())).origin;
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not validate that server address." }, { status: 400 });
  }

  try {
    const { token, resolvedSiteId } = await signIn(origin, siteId ?? "", tokenName, tokenSecret);
    const viewId = await findViewId(origin, token, resolvedSiteId, viewName);
    const csvText = await fetchViewCsv(origin, token, resolvedSiteId, viewId);

    return NextResponse.json({ csvText, source: `Tableau · ${viewName}` });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return NextResponse.json(
        { error: safeUpstreamMessage("Tableau", err.status, err.detail, err.context) },
        { status: 502 }
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: safeUpstreamMessage("Tableau", undefined, detail, "connection") },
      { status: 502 }
    );
  }
}
