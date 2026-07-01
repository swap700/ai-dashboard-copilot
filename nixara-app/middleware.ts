import { NextRequest, NextResponse } from "next/server";

/**
 * Edge middleware — IP-based sliding-window rate limiter for all /api/* routes.
 *
 * Uses an in-memory Map (resets on cold start). For cross-instance persistence
 * upgrade to @upstash/ratelimit + Upstash Redis (free tier covers this app).
 *
 * Limits:
 *   /api/generate-report  →  6 req / IP / min  (1 full analysis = 3 reports, 2 attempts)
 *   /api/export/*         →  20 req / IP / min
 *   everything else       →  30 req / IP / min
 */

const ipMap = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;

const ROUTE_LIMITS: Record<string, number> = {
  "/api/generate-report": 6,
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
