import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * The anon key is meant to be public (security is enforced by RLS, not
 * key secrecy) — mirrors the original app's direct use of the Supabase
 * anon key from st.secrets.
 */
export const supabase = url && key ? createClient(url, key) : null;
