import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { buildPrompt, cleanAiOutput, REPORT_TYPES, type ReportType } from "@/lib/report";
import { resolveApiKey } from "@/lib/openai-key";

export const runtime = "nodejs";

// ── Payload size limits — Fix C2 (token amplification) ──────────────────────
const MAX_SUMMARY_CHARS = 8_000;
const MAX_FIELD_CHARS   = 300;

// ── Free-tier limits ─────────────────────────────────────────────────────────
const FREE_LIMIT       = 3;
const FREE_WINDOW_SECS = 6 * 60 * 60;             // 6 hours (KV TTL)
const FREE_WINDOW_MS   = FREE_WINDOW_SECS * 1_000; // in-memory fallback uses ms

// In-memory fallback — used when Vercel KV env vars are absent (local dev).
// Resets on cold start, which is acceptable in that context.
const freeTierMap = new Map<string, { used: number; resetAt: number }>();

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Check and increment the per-IP free-tier counter.
 *
 * Priority:
 *   1. Vercel KV (persistent across cold starts and multiple instances) —
 *      activated when KV_REST_API_URL + KV_REST_API_TOKEN are set (Vercel sets
 *      these automatically when you link a KV store to the project).
 *   2. In-memory Map fallback — local dev or KV not yet provisioned.
 */
async function checkFreeTier(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  // ── Vercel KV path ────────────────────────────────────────────────────────
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      // Dynamic import keeps the bundle clean when KV isn't installed yet.
      const { kv } = await import("@vercel/kv");
      const key  = `nixara:free:${ip}`;
      const used = (await kv.incr(key)) as number;
      if (used === 1) {
        // First hit in this window — attach a TTL so the key auto-expires.
        await kv.expire(key, FREE_WINDOW_SECS);
      }
      if (used > FREE_LIMIT) return { allowed: false, remaining: 0 };
      return { allowed: true, remaining: FREE_LIMIT - used };
    } catch {
      // KV error (misconfigured, network blip) — fall through to in-memory.
    }
  }

  // ── In-memory fallback ────────────────────────────────────────────────────
  const now   = Date.now();
  const entry = freeTierMap.get(ip);
  if (!entry || now > entry.resetAt) {
    freeTierMap.set(ip, { used: 1, resetAt: now + FREE_WINDOW_MS });
    return { allowed: true, remaining: FREE_LIMIT - 1 };
  }
  if (entry.used >= FREE_LIMIT) return { allowed: false, remaining: 0 };
  entry.used += 1;
  return { allowed: true, remaining: FREE_LIMIT - entry.used };
}

interface Body {
  who: string;
  decision: string;
  timeframe: string;
  reportType: ReportType;
  summary: string;
  userKey?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { who, decision, timeframe, reportType, summary, userKey } = body;

  // ── Required field check ─────────────────────────────────────────────────
  if (!who || !decision || !timeframe || !summary) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }
  if (!REPORT_TYPES.includes(reportType)) {
    return NextResponse.json({ error: "Invalid report type." }, { status: 400 });
  }

  // ── Payload size caps (Fix C2) ───────────────────────────────────────────
  if (summary.length > MAX_SUMMARY_CHARS) {
    return NextResponse.json(
      { error: `Summary too large — maximum ${MAX_SUMMARY_CHARS.toLocaleString()} characters allowed.` },
      { status: 413 }
    );
  }
  if (
    who.length       > MAX_FIELD_CHARS ||
    decision.length  > MAX_FIELD_CHARS ||
    timeframe.length > MAX_FIELD_CHARS
  ) {
    return NextResponse.json(
      { error: "One or more fields exceed the maximum allowed length." },
      { status: 413 }
    );
  }

  // ── Resolve API key & tier ───────────────────────────────────────────────
  const { apiKey, tier } = resolveApiKey(userKey);
  if (!apiKey) {
    return NextResponse.json(
      { error: "No OpenAI API key available. Paste your own key, or contact the admin." },
      { status: 401 }
    );
  }

  // ── Server-side free-tier gate (Fix C1 + Task 10: now KV-backed) ─────────
  if (tier === "free") {
    const ip = getIp(req);
    const { allowed, remaining } = await checkFreeTier(ip);
    if (!allowed) {
      return NextResponse.json(
        {
          error:
            "You've used all 3 free reports for this session. " +
            "Paste your own OpenAI key (starts with sk-) in the sidebar to continue.",
        },
        { status: 429 }
      );
    }
    const prompt = buildPrompt({ who, decision, timeframe, reportType, summary });
    try {
      const client   = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model:      "gpt-4o",
        max_tokens: 1024,
        messages:   [{ role: "user", content: prompt }],
      });
      const raw  = response.choices[0]?.message?.content ?? "";
      const text = cleanAiOutput(raw);
      return NextResponse.json({ text, tier, freeRemaining: remaining });
    } catch (err) {
      const message = err instanceof Error ? err.message : "OpenAI request failed.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  // ── Own key / admin tier — no free-tier gate ─────────────────────────────
  const prompt = buildPrompt({ who, decision, timeframe, reportType, summary });
  try {
    const client   = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model:      "gpt-4o",
      max_tokens: 1024,
      messages:   [{ role: "user", content: prompt }],
    });
    const raw  = response.choices[0]?.message?.content ?? "";
    const text = cleanAiOutput(raw);
    return NextResponse.json({ text, tier });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OpenAI request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
