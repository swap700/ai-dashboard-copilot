/**
 * Server-only port of get_client's three-tier key resolution
 * (dashboard_ai_app.py lines 643-662). Never import this from client code.
 */

export type KeyTier = "admin" | "own" | "free" | "none";

export function resolveApiKey(userKey: string | undefined): { apiKey: string; tier: KeyTier } {
  const trimmed = (userKey ?? "").trim();
  const adminToken = (process.env.NIXARA_ADMIN_TOKEN ?? "").trim();
  const serverKey = (process.env.OPENAI_API_KEY ?? "").trim();

  if (trimmed && adminToken && trimmed === adminToken) {
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
