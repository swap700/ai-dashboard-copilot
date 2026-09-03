import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { buildPrompt, cleanAiOutput, REPORT_TYPES, type ReportType } from "@/lib/report";
import { resolveApiKey } from "@/lib/openai-key";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

// ── Payload size limits — Fix C2 (token amplification) ──────────────────────
const MAX_SUMMARY_CHARS = 8_000;
const MAX_FIELD_CHARS   = 300;

// ── Free-tier limits ─────────────────────────────────────────────────────────
const FREE_LIMIT     = 3;
const COOKIE_NAME    = "nixara_ftu";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

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
  const prompt      = buildPrompt({ who, decision, timeframe, reportType, summary });

  // ── Free-tier gate ───────────────────────────────────────────────────────
  if (tier === "free") {
    const { allowed, sessions, isNewSession } = checkFreeTierCookie(req, sessionId);

    if (!allowed) {
      return NextResponse.json(
        {
          error:
            `You've used all ${FREE_LIMIT} free generate sessions. ` +
            "Paste your own OpenAI key (starts with sk-) in the field below to continue.",
        },
        { status: 429 }
      );
    }

    try {
      const client   = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model:      "gpt-4o",
        max_tokens: 1024,
        messages:   [{ role: "user", content: prompt }],
      });
      const raw  = response.choices[0]?.message?.content ?? "";
      const text = cleanAiOutput(raw);

      const updatedSessions = isNewSession && sessionId
        ? [...sessions, sessionId]
        : sessions;
      const freeRemaining = Math.max(0, FREE_LIMIT - updatedSessions.length);

      // Log analytics — after success, before returning
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

  // ── Own key / admin tier ─────────────────────────────────────────────────
  try {
    const client   = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model:      "gpt-4o",
      max_tokens: 1024,
      messages:   [{ role: "user", content: prompt }],
    });
    const raw  = response.choices[0]?.message?.content ?? "";
    const text = cleanAiOutput(raw);

    // Log analytics — after success, before returning
    void logReportGenerate(resolvedSid, who, timeframe, reportType, dataSource, referrer);

    return NextResponse.json({ text, tier });
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