import { createClient } from "@supabase/supabase-js";

/**
 * Supabase connection.
 *
 * The URL and key come from environment variables so that Sandbox and
 * Production can build from the same repository while pointing at different
 * databases. Each Vercel deployment supplies its own values.
 *
 * The publishable key is public by design — it is sent to every browser that
 * loads this app. What protects the data is row-level security (migrations
 * 0004, 0008, 0009), not the secrecy of this string. Putting it in an
 * environment variable is about separating environments, not about hiding it.
 *
 * The service_role / secret key is a different thing entirely and must NEVER
 * appear here or in any variable prefixed VITE_, because everything with that
 * prefix is compiled into the browser bundle.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_KEY as
  | string
  | undefined;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  // Fail loudly at startup rather than producing confusing network errors
  // later. A missing variable here means the deployment was configured wrong.
  throw new Error(
    "Supabase is not configured. This deployment needs two environment " +
      "variables: VITE_SUPABASE_URL and VITE_SUPABASE_KEY. Set them in " +
      "Vercel under Settings -> Environment Variables, then redeploy — " +
      "environment variables only apply to new builds.",
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
