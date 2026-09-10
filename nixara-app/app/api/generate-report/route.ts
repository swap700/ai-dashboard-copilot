import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { buildPrompt, cleanAiOutput, REPORT_TYPES, type ReportType } from "@/lib/report";
import { resolveApiKey } from "@/lib/openai-key";
import { supabase } from "@/lib/supabase";
import { findUnverifiedLines, type EvidenceFact } from "@/lib/evidence";
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

/**
 * evidenceFacts is the client's already-computed buildEvidenceFacts(dataset)
 * output — column means/sums/min/max and category-crossed breakdowns, NEVER
 * raw rows. This is the same privacy class of data as `summary` above (both
 * are aggregate statistics derived from the dataset, which itself never
 * leaves the browser — see lib/data-analysis.ts). buildEvidenceFacts() is
 * already internally bounded (≤12 metric columns, ≤4 categories × ≤4 metrics
 * × ≤20 values each), so a well-formed payload should never approach this
 * cap; it exists only as defense against a malformed or adversarial request
 * body, matching the payload-cap posture already established for `summary`.
 * An oversized array is not treated as a hard failure — the report itself
 * doesn't depend on it — it's simply ignored, same as if it were absent.
 */
const MAX_EVIDENCE_FACTS = 1_000;

// ── OpenAI call bounds ──────────────────────────────────────────────────────
const OPENAI_TIMEOUT_MS = 60_000;
// Shorter budget for the correction retry specifically: it only ever fires
// after the primary call already succeeded, so a slow retry should not be
// allowed to double the worst-case request time — better to fall back to
// the unverified original (still caught by the client-side badge/
// strikethrough treatment) than let one request hang for up to 120s.
const RETRY_TIMEOUT_MS = 25_000;

/**
 * BUG FIX (2026-09): this was 1024 and finish_reason was never inspected.
 *
 * The Operational Detail and Risk Report prompts both ask for "under 500
 * words" across four or five headed sections, and the Risk Report additionally
 * asks for three risks each with five labelled lines. 500 words of prose is
 * roughly 700 tokens before any of that structure, so 1024 was not comfortable
 * headroom - it was close enough that real reports hit the ceiling.
 *
 * When they did, the model stopped mid-sentence and the app rendered the
 * fragment as a finished report. Nothing detected it, nothing told the user.
 * A risk report that ends halfway through the second of three risks looks like
 * a complete report that only found one and a half risks.
 *
 * Raised to give genuine headroom, AND checked, because a cap you do not
 * inspect is a cap that fails silently. Output tokens are billed as used, so a
 * higher ceiling costs nothing on reports that were never near it.
 */
const OPENAI_MAX_TOKENS = 1600;

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
  /** Aggregate facts (means, sums, category breakdowns) for the verify-and-correct pass below. Optional and best-effort — see MAX_EVIDENCE_FACTS. */
  evidenceFacts?: EvidenceFact[];
}

interface GenerateResult {
  text: string;
  /** The model hit the token ceiling and the report is cut off mid-thought. */
  truncated: boolean;
  /** A fabricated figure was caught and an automatic correction pass replaced this text before it was ever returned. */
  corrected: boolean;
}

/**
 * BUG FIX (2026-09): Risk Report structurally has more to say than the other
 * two report types — 3 full risk objects (name + Likelihood + Impact +
 * Signal + Consequence + type tag), plus 3-4 Early Warning Signs, plus one
 * Mitigation Action per risk, plus a Data Quality paragraph. A single shared
 * ceiling sized for Executive Summary/Operational Detail leaves Risk Report
 * the most exposed to truncation, and — because Mitigation Actions and Data
 * Quality Risks are the LAST sections in its prompt — that's exactly the
 * content most likely to come back missing when the model runs long
 * elsewhere in the same response (e.g. verbose Signal/Consequence prose).
 * Reported symptom before this fix: "sometimes I don't see recommendations
 * in the Risk Report" with no truncation warning shown — consistent with the
 * model finishing within 1600 tokens on most datasets but not all.
 */
function maxTokensFor(reportType: ReportType): number {
  return reportType === "Risk Report" ? 2200 : OPENAI_MAX_TOKENS;
}

async function generate(
  apiKey: string,
  prompt: string,
  reportType: ReportType,
  timeoutMs: number = OPENAI_TIMEOUT_MS
): Promise<{ text: string; truncated: boolean }> {
  const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  const maxTokens = maxTokensFor(reportType);
  const response = await client.chat.completions.create({
    model:      "gpt-4o",
    max_tokens: maxTokens,
    messages:   [{ role: "user", content: prompt }],
  });

  const choice = response.choices[0];
  // "length" means the model was cut off by max_tokens rather than finishing.
  // "stop" is a normal completion; anything else is unexpected but not a
  // truncation, so it is not reported as one.
  const truncated = choice?.finish_reason === "length";

  if (truncated) {
    console.warn(
      `[generate-report] Output truncated at max_tokens=${maxTokens} for ${reportType} ` +
        `(completion_tokens=${response.usage?.completion_tokens ?? "unknown"}). ` +
        "If this recurs, raise the ceiling further or tighten the prompt's length rule."
    );
  }

  return { text: cleanAiOutput(choice?.message?.content ?? ""), truncated };
}

function buildCorrectionPrompt(originalPrompt: string, badLines: string[]): string {
  return `${originalPrompt}

CORRECTION REQUIRED: your previous attempt at this report included the following statements, each of which cites a specific number that does not match anything in the Dashboard data above:

${badLines.map((l) => `- "${l}"`).join("\n")}

Write the full report again from scratch. For each statement listed above, either replace the number with the correct one from the Dashboard data if a matching figure exists there, or rewrite the statement using qualitative language with no specific number if none applies. Do not introduce any new specific number that is not present in, or directly calculable from, the Dashboard data. Everything in the report that was not listed above may stay as it was.`;
}

/**
 * Generate → verify every cited number against the real data → if any are
 * fabricated, ask the model to correct itself once, in the same request,
 * before the report is ever returned to the client.
 *
 * Why this exists: prompt rules alone don't reliably stop fabrication — the
 * report prompts already ban invented figures explicitly, and a live report
 * still cited a job title's average experience as 11.70 years when the real
 * value (independently recomputed from the uploaded dataset) was 14.15.
 * Verification-after-display (the client-side "unverified" badge) catches
 * that, but only after showing the number in full visual confidence. This
 * closes the gap one step earlier: the same check runs here, server-side,
 * and if it fails, the model gets one chance to fix its own mistake before
 * a person ever sees it.
 *
 * Deliberately bounded, not a guarantee: exactly one retry, never a loop.
 * If the correction attempt is truncated, errors, or still contains
 * unverified figures, this returns the best text available (the retry's
 * output if it completed cleanly even with some issues remaining, otherwise
 * the original) rather than hanging or discarding real content — the
 * client-side badge/strikethrough treatment remains the final backstop for
 * whatever survives past this point. `evidenceFacts` is optional: callers
 * that don't provide it (e.g. an older client, or a BI-connector path that
 * hasn't been updated) get exactly today's behavior, unverified.
 */
async function generateVerified(
  apiKey: string,
  prompt: string,
  reportType: ReportType,
  evidenceFacts: EvidenceFact[] | undefined
): Promise<GenerateResult> {
  const first = await generate(apiKey, prompt, reportType);

  if (first.truncated || !evidenceFacts || evidenceFacts.length === 0) {
    return { ...first, corrected: false };
  }

  const badLines = findUnverifiedLines(first.text, evidenceFacts);
  if (badLines.length === 0) {
    return { ...first, corrected: false };
  }

  console.warn(
    `[generate-report] ${reportType}: ${badLines.length} unverified figure(s) found, ` +
      "attempting one correction pass."
  );

  try {
    const retry = await generate(apiKey, buildCorrectionPrompt(prompt, badLines), reportType, RETRY_TIMEOUT_MS);
    // A truncated retry is worse than an original with some flagged figures
    // still in it — a half-written correction has no coherent fallback of
    // its own. Only adopt the retry if it actually finished.
    if (!retry.truncated) {
      return { text: retry.text, truncated: false, corrected: true };
    }
  } catch (err) {
    console.warn(`[generate-report] Correction retry failed for ${reportType}, keeping original:`, err);
  }

  return { ...first, corrected: false };
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { who, decision, timeframe, reportType, summary, userKey, sessionId, dataSource = "csv" } = body;
  let { evidenceFacts } = body;

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
  if (!Array.isArray(evidenceFacts) || evidenceFacts.length > MAX_EVIDENCE_FACTS) {
    if (evidenceFacts !== undefined) {
      console.warn(
        `[generate-report] evidenceFacts missing/malformed/oversized ` +
          `(${Array.isArray(evidenceFacts) ? evidenceFacts.length : typeof evidenceFacts}) — ` +
          "proceeding without server-side verification for this request."
      );
    }
    evidenceFacts = undefined;
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
      const { text, truncated, corrected } = await generateVerified(apiKey, prompt, reportType, evidenceFacts);
      void logReportGenerate(resolvedSid, who, timeframe, reportType, dataSource, referrer);
      return NextResponse.json({ text, tier, truncated, corrected });
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
    const { text, truncated, corrected } = await generateVerified(apiKey, prompt, reportType, evidenceFacts);

    const updatedSessions = isNewSession && sessionId ? [...sessions, sessionId] : sessions;
    const freeRemaining = Math.max(0, FREE_LIMIT - updatedSessions.length);

    void logReportGenerate(resolvedSid, who, timeframe, reportType, dataSource, referrer);

    const res = NextResponse.json({ text, tier, freeRemaining, truncated, corrected });
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
