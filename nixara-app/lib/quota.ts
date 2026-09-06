import { supabaseAdmin, isQuotaBackendConfigured } from "./supabase-admin";

/**
 * Shared, cross-instance quota counters (H3).
 *
 * What this replaces: a free-tier gate that was an HttpOnly cookie (cleared by
 * incognito, absent from curl) plus an in-memory Map in edge middleware (per
 * instance, reset on every cold start). Together those left the operator's
 * OpenAI key effectively open to unauthenticated callers, with no global cap.
 *
 * Design notes:
 *   - Counting happens in Postgres, in one atomic statement, so concurrent
 *     serverless instances share one view of the count.
 *   - Two independent gates are applied to any request that spends the SERVER
 *     key: a per-IP window and a global daily cap. The per-IP gate stops one
 *     caller; the global cap bounds the operator's worst-case daily bill even
 *     against a distributed attack.
 *   - FAILS CLOSED. If the backend is unreachable or unconfigured, requests
 *     that would spend the server key are refused. The entire point of this
 *     module is to bound spend, so degrading to "unlimited" on error would
 *     defeat it. Callers using their OWN key are never gated here.
 */

export interface QuotaResult {
  allowed: boolean;
  used: number;
  resetsAt: Date | null;
  /** True when the decision came from a failure rather than a real count. */
  degraded: boolean;
}

const DENIED_DEGRADED: QuotaResult = {
  allowed: false,
  used: 0,
  resetsAt: null,
  degraded: true,
};

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Free generate-sessions allowed per IP per window. */
export const FREE_SESSIONS_PER_IP = intFromEnv("NIXARA_FREE_SESSIONS_PER_IP", 3);
/** Window for the per-IP allowance, in seconds. Default 24h. */
export const FREE_IP_WINDOW_SECONDS = intFromEnv("NIXARA_FREE_IP_WINDOW_SECONDS", 86_400);
/** Hard ceiling on server-key generate-sessions per day, across all callers. */
export const GLOBAL_DAILY_SESSION_CAP = intFromEnv("NIXARA_DAILY_FREE_SESSION_CAP", 300);
/** Short burst window per IP, guarding the route itself. */
export const BURST_PER_IP = intFromEnv("NIXARA_BURST_PER_IP", 12);
export const BURST_WINDOW_SECONDS = intFromEnv("NIXARA_BURST_WINDOW_SECONDS", 60);

export { isQuotaBackendConfigured };

/**
 * Consumes one unit from a bucket. Returns whether the caller may proceed.
 * Never throws — a failure is reported as a denied, degraded result.
 */
export async function consumeQuota(
  bucket: string,
  limit: number,
  windowSeconds: number
): Promise<QuotaResult> {
  if (!supabaseAdmin) {
    console.error(
      "[quota] SUPABASE_SERVICE_ROLE_KEY is not set — refusing server-key spend. " +
        "Set it, and run section 13 of nixara_supabase_setup.sql."
    );
    return DENIED_DEGRADED;
  }

  try {
    const { data, error } = await supabaseAdmin.rpc("consume_quota", {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      console.error(`[quota] consume_quota failed for ${bucket}: ${error.message}`);
      return DENIED_DEGRADED;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      console.error(`[quota] consume_quota returned no row for ${bucket}`);
      return DENIED_DEGRADED;
    }

    return {
      allowed: Boolean(row.allowed),
      used: Number(row.used ?? 0),
      resetsAt: row.resets_at ? new Date(row.resets_at) : null,
      degraded: false,
    };
  } catch (err) {
    console.error(`[quota] consume_quota threw for ${bucket}:`, err);
    return DENIED_DEGRADED;
  }
}

/**
 * Derives the client IP from proxy headers.
 *
 * On Vercel x-forwarded-for is set by the platform and the left-most entry is
 * the real client. Off-platform this header is caller-controlled, so this is a
 * best-effort key, not an identity — which is exactly why the global cap
 * exists alongside it.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
