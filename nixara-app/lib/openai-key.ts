/**
 * Server-only port of get_client's three-tier key resolution
 * (dashboard_ai_app.py lines 643-662). Never import this from client code.
 */

import { timingSafeEqual } from "crypto";

export type KeyTier = "admin" | "own" | "free" | "none";

/**
 * Constant-time string comparison — prevents timing attacks where an attacker
 * measures response latency to guess the admin token character by character.
 * Returns false immediately (without leaking length) if lengths differ.
 */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // Lengths must match for timingSafeEqual — if they differ, run a dummy
  // comparison on same-length buffers so timing is constant, then return false.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA); // consume constant time, discard result
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function resolveApiKey(userKey: string | undefined): { apiKey: string; tier: KeyTier } {
  const trimmed    = (userKey ?? "").trim();
  const adminToken = (process.env.NIXARA_ADMIN_TOKEN ?? "").trim();
  const serverKey  = (process.env.OPENAI_API_KEY ?? "").trim();

  // Fix M1: use constant-time comparison instead of ===
  if (trimmed && adminToken && safeEqual(trimmed, adminToken)) {
    return { apiKey: serverKey, tier: "admin" };
  }
  if (trimmed.startsWith("sk-")) {
    return { apiKey: trimmed, tier: "own" };
  }
  if (serverKey) {
    return { apiKey: serverKey, tier: "free" };
  }
  return { apiKey: "", tier: "none" };
}
