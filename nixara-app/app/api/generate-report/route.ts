import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { buildPrompt, cleanAiOutput, REPORT_TYPES, type ReportType } from "@/lib/report";
import { resolveApiKey } from "@/lib/openai-key";
import { supabase } from "@/lib/supabase";
import {
  consumeQuota,
  clientIp,
  isQuotaBackendConfigured,
  FREE_SESSIONS_PER_IP,
  FREE_IP_WINDOW_SECONDS,
  GLOBAL_DAILY_SESSION_CAP,
  BURST_PER_IP,
  BURST_WINDOW_SECONDS,
} from "@/lib/quota";

export const runtime = "nodejs";

// ── Payload size limits — Fix C2 (token amplification) ──────────────────────
const MAX_SUMMARY_CHARS = 8_000;
const MAX_FIELD_CHARS   = 300;

// ── OpenAI call bounds ──────────────────────────────────────────────────────
const OPENAI_TIMEOUT_MS = 60_000;
const OPENAI_MAX_TOKENS = 1024;

// ── Free-tier cookie (cheap first check only — see the note below) ──────────
const FREE_LIMIT     = 3;
const COOKIE_NAME    = "nixara_ftu";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * SECURITY FIX (H3 — unbounded spend on the server's OpenAI key).
 *
 * The free tier resolves to the OPERATOR's OPENAI_API_KEY. Before this fix the
 * only thing standing between an anonymous caller and unlimited GPT-4o traffic
 * on that key was:
 *   - an HttpOnly cookie, which incognito clears and curl never sends; and
 *   - an in-memory Map in edge middleware, which is per-instance and resets on
 *     every cold start, so in a serverless deployment it is close to no limit.
 * There was no global cap of any kind.
 *
 * The cookie is kept, because it is free and it gives an honest returning user
 * the right message. But it is now only the first of three gates, and it is no
 * longer the one that protects the money:
 *
 *   1. cookie              — cheap, advisory, trivially bypassed
 *   2. per-IP quota        — shared across instances, survives cold starts
 *   3. global daily cap    — bounds the worst-case daily bill even against a
 *                            distributed attack from many IPs
 *
 * Gates 2 and 3 fail closed: if the quota backend is unreachable, free-tier
 * requests are refused rather than allowed. Callers using their own key are
 * never gated by any of this.
 */

function checkFreeTierCookie(
  req: NextRequest,
  sessionId: string | undefined
): { allowed: boolean; sessions: string[]; isNewSession: boolean } {
  const raw = req.cookies.get(COOKIE_NAME)?.value ?? "[]";
  let sessions: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    sessions = Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    sessions = [];
  }

  if (sessionId && sessions.includes(sessionId)) {
    return { allowed: true, sessions, isNewSession: false };
  }

  const isNewSession = !!sessionId;
  if (isNewSession && sessions.length >= FREE_LIMIT) {
    return { allowed: false, sessions, isNewSession: true };
  }

  return { allowed: true, sessions, isNewSession };
}

// ── Analytics — fire-and-forget, never blocks response ───────────────────────
async function logReportGenerate(
  sessionId: string,
  who: string,
  timeframe: string,
  reportType: ReportType,
  dataSource: string,
  referrer: string | null
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("nixara_events").insert({
      session_id:  sessionId,
      event_type:  "report_generate",
      role:        who,
      timeframe,
      report_type: reportType,
      data_source: dataSource,
      referrer,
    });
  } catch {
    // Never surface analytics errors to the user
  }
}

interface Body {
  who: string;
  decision: string;
  timeframe: string;
  reportType: ReportType;
  summary: string;
  userKey?: string;
  sessionId?: string;
  dataSource?: "csv" | "excel" | "tableau" | "powerbi";
}

async function generate(apiKey: string, prompt: string): Promise<string> {
  const client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 1 });
  const response = await client.chat.completions.create({
    model:      "gpt-4o",
    max_tokens: OPENAI_MAX_TOKENS,
    messages:   [{ role: "user", content: prompt }],
  });
  return cleanAiOutput(response.choices[0]?.message?.content ?? "");
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { who, decision, timeframe, reportType, summary, userKey, sessionId, dataSource = "csv" } = body;

  // ── Required field check ─────────────────────────────────────────────────
  if (!who || !decision || !timeframe || !summary) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }
  if (!REPORT_TYPES.includes(reportType)) {
    return NextResponse.json({ error: "Invalid report type." }, { status: 400 });
  }

  // ── Payload size caps ────────────────────────────────────────────────────
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

  const referrer    = req.headers.get("referer");
  const resolvedSid = sessionId ?? "unknown";
  const ip          = clientIp(req.headers);
  const prompt      = buildPrompt({ who, decision, timeframe, reportType, summary });

  // ── Own key / admin tier: no spend gate, the caller pays ─────────────────
  if (tier !== "free") {
    try {
      const text = await generate(apiKey, prompt);
      void logReportGenerate(resolvedSid, who, timeframe, reportType, dataSource, referrer);
      return NextResponse.json({ text, tier });
    } catch (err) {
      return NextResponse.json({ error: safeOpenAiErrorMessage(err) }, { status: 502 });
    }
  }

  // ── Free tier: three gates before a single token is spent ────────────────

  // Gate 0 — refuse outright if the spend controls are not wired up.
  if (!isQuotaBackendConfigured) {
    console.error(
      "[generate-report] Free tier disabled: SUPABASE_SERVICE_ROLE_KEY is unset, " +
        "so server-key spend cannot be bounded."
    );
    return NextResponse.json(
      {
        error:
          "The free tier is temporarily unavailable. Paste your own OpenAI key " +
          "(starts with sk-) to continue.",
      },
      { status: 503 }
    );
  }

  // Gate 1 — cookie. Cheap and advisory; not the control that protects spend.
  const { allowed: cookieAllowed, sessions, isNewSession } = checkFreeTierCookie(req, sessionId);
  if (!cookieAllowed) {
    return NextResponse.json(
      {
        error:
          `You've used all ${FREE_LIMIT} free generate sessions. ` +
          "Paste your own OpenAI key (starts with sk-) in the field below to continue.",
        freeRemaining: 0,
        tier,
      },
      { status: 429 }
    );
  }

  // Gate 2 — per-IP burst, on every request including repeats within a session.
  const burst = await consumeQuota(`burst:${ip}`, BURST_PER_IP, BURST_WINDOW_SECONDS);
  if (!burst.allowed) {
    return NextResponse.json(
      {
        error: burst.degraded
          ? "The free tier is temporarily unavailable. Paste your own OpenAI key to continue."
          : "Too many requests — please wait a moment before trying again.",
      },
      { status: burst.degraded ? 503 : 429, headers: { "Retry-After": String(BURST_WINDOW_SECONDS) } }
    );
  }

  // Gates 3 and 4 apply once per generate SESSION, not once per report type,
  // so one click (three report types) costs one unit.
  if (isNewSession) {
    const perIp = await consumeQuota(
      `free:${ip}`,
      FREE_SESSIONS_PER_IP,
      FREE_IP_WINDOW_SECONDS
    );
    if (!perIp.allowed) {
      return NextResponse.json(
        {
          error: perIp.degraded
            ? "The free tier is temporarily unavailable. Paste your own OpenAI key (starts with sk-) to continue."
            : `You've used all ${FREE_SESSIONS_PER_IP} free reports for today. ` +
              "Paste your own OpenAI key (starts with sk-) to keep going.",
          freeRemaining: 0,
          tier,
        },
        { status: perIp.degraded ? 503 : 429 }
      );
    }

    const global = await consumeQuota(
      "global:free-sessions",
      GLOBAL_DAILY_SESSION_CAP,
      86_400
    );
    if (!global.allowed) {
      if (!global.degraded) {
        console.warn(
          `[generate-report] Global daily free-tier cap reached ` +
            `(${global.used}/${GLOBAL_DAILY_SESSION_CAP}).`
        );
      }
      return NextResponse.json(
        {
          error:
            "Nixara's free tier is at capacity for today. Paste your own OpenAI key " +
            "(starts with sk-) to continue right away.",
          freeRemaining: 0,
          tier,
        },
        { status: 503 }
      );
    }
  }

  // ── Cleared to spend ─────────────────────────────────────────────────────
  try {
    const text = await generate(apiKey, prompt);

    const updatedSessions = isNewSession && sessionId ? [...sessions, sessionId] : sessions;
    const freeRemaining = Math.max(0, FREE_LIMIT - updatedSessions.length);

    void logReportGenerate(resolvedSid, who, timeframe, reportType, dataSource, referrer);

    const res = NextResponse.json({ text, tier, freeRemaining });
    res.cookies.set(COOKIE_NAME, JSON.stringify(updatedSessions), {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   COOKIE_MAX_AGE,
      path:     "/",
    });
    return res;
  } catch (err) {
    return NextResponse.json({ error: safeOpenAiErrorMessage(err) }, { status: 502 });
  }
}

function safeOpenAiErrorMessage(err: unknown): string {
  const status =
    err && typeof err === "object" && "status" in err ? (err as { status?: number }).status : undefined;

  if (status === 401) return "The OpenAI key on file was rejected. Check the key and try again.";
  if (status === 429) return "OpenAI rate or quota limit reached. Wait a moment and try again.";
  if (status && status >= 500) return "OpenAI is temporarily unavailable. Please try again shortly.";
  return "Report generation failed. Please try again.";
}
