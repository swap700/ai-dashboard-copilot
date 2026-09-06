import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client, using the service-role key.
 *
 * NEVER import this from a client component. The anon client in lib/supabase.ts
 * is the one safe to use in the browser; this one bypasses RLS entirely.
 *
 * It exists because the quota counters (H3) must not be reachable by anon. If
 * a browser could call consume_quota it could burn the global bucket itself
 * and deny service to every other user, turning a spend control into a DoS.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const supabaseAdmin: SupabaseClient | null =
  url && serviceKey
    ? createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export const isQuotaBackendConfigured = Boolean(url && serviceKey);
