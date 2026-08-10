import { createClient } from "@supabase/supabase-js";

/**
 * Supabase connection.
 *
 * These two values are deliberately committed rather than read from environment
 * variables. The publishable key is public by design — it is meant to be sent
 * to every browser that loads this app. What protects the data is row-level
 * security (migration 0004), not the secrecy of this string.
 *
 * The service_role / secret key is a different thing entirely and must NEVER
 * appear in this file or anywhere else in the web app.
 *
 * If the key is ever rotated in Supabase, edit it here and commit.
 */
const SUPABASE_URL = "https://bmjmsjxxqtllbihanayz.supabase.co";

// Supabase dashboard → Settings → API → Publishable key → copy button.
// Replace the line below with the full value. It starts with sb_publishable_
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_n5MIQ8z1vjW7T9WU6teu6Q_1HMFFISm";

if (SUPABASE_PUBLISHABLE_KEY.startsWith("PASTE_")) {
  throw new Error(
    "Supabase key not set. Open web/src/lib/supabase.ts and replace " +
      "sb_publishable_n5MIQ8z1vjW7T9WU6teu6Q_1HMFFISm" +
      "Supabase → Settings → API.",
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
