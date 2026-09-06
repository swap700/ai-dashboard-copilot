import { NextRequest, NextResponse } from "next/server";

/**
 * Edge middleware - best-effort IP burst limiter for /api/* routes.
 *
 * IMPORTANT (H3): this is NOT the control that protects the operator's OpenAI
 * spend, and it must never be relied on as one. The Map below lives in a
 * single instance's memory: it resets on every cold start and each concurrent
 * instance keeps its own copy, so the effective limit in a serverless
 * deployment is some unknown multiple of the number below. It is kept only
 * because it is free and it sheds the most naive floods before they reach a
 * function invocation.
 *
 * The real, shared, cross-instance limits live in lib/quota.ts and are applied
 * inside /api/generate-report itself, backed by an atomic Postgres counter.
 * If you are changing limits, change them there.
 */

const ipMap = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;

const ROUTE_LIMITS: Record<string, number> = {
  "/api/generate-report": 6,   // advisory only - see lib/quota.ts for the real gate
  "/api/export/pdf":      20,
  "/api/export/docx":     20,
};
const DEFAULT_LIMIT = 30;

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function isLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const entry = ipMap.get(key);
  if (!entry || now > entry.resetAt) {
    ipMap.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

// Prune stale entries periodically to avoid memory growth
let lastPrune = Date.now();
function maybePrune() {
  const now = Date.now();
  if (now - lastPrune < 5 * 60_000) return; // prune every 5 min
  lastPrune = now;
  for (const [k, v] of ipMap) {
    if (now > v.resetAt) ipMap.delete(k);
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  maybePrune();

  const ip = getIp(req);
  const limit = ROUTE_LIMITS[pathname] ?? DEFAULT_LIMIT;
  const key = `${ip}::${pathname}`;

  if (isLimited(key, limit)) {
    return NextResponse.json(
      { error: "Too many requests — please wait a moment before trying again." },
      {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Limit": String(limit),
        },
      }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
