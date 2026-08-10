import { supabase } from "@/lib/supabase";

/**
 * Deliberately spare: one button, no form, no marketing copy.
 * Google Workspace sign-in means no password to manage, reset, or leak, and
 * offboarding in Workspace immediately terminates platform access.
 */
export function SignIn(): JSX.Element {
  async function signIn(): Promise<void> {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-sm text-center">
        <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-45">
          Capability &amp; Development
        </p>
        <h1 className="font-display text-4xl mt-2 mb-8">Moment Library</h1>
        <button
          onClick={() => void signIn()}
          className="w-full bg-ink text-ground border border-ink rounded px-4 py-2.5
                     font-medium hover:opacity-85 transition-opacity"
        >
          Continue with Google
        </button>
      </div>
    </main>
  );
}
