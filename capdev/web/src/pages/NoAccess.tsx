import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { EnvironmentBadge } from "@/components/EnvironmentBadge";

/**
 * Signed in, but not provisioned in CapDev.
 *
 * The screen must offer a way out. Without one this is a dead end: the session
 * is persisted in local storage, so it survives closing the tab, and the only
 * sign-out in the application lives in AppShell — which never renders for
 * someone in this state. The result is a browser that cannot reach the sign-in
 * page again.
 */
export function NoAccess({ email }: { email: string }): JSX.Element {
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);
    await supabase.auth.signOut();
    // Belt and braces: signOut clears the stored session and the auth listener
    // re-resolves, but a reload guarantees no stale state survives — this
    // screen exists precisely because someone is already stuck.
    window.location.replace(window.location.origin);
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-md text-center">
        <div className="mb-3">
          <EnvironmentBadge />
        </div>
        <h1 className="font-display text-3xl mb-3">No access yet</h1>
        <p className="text-ink-70 mb-6">
          You&rsquo;re signed in as <span className="font-mono text-sm">{email}</span>, but
          that address hasn&rsquo;t been added to the platform. Ask an administrator
          to invite you.
        </p>

        <button
          onClick={() => void signOut()}
          disabled={busy}
          className="bg-ink text-ground border border-ink rounded px-4 py-2.5
                     font-medium hover:opacity-85 transition-opacity disabled:opacity-40"
        >
          {busy ? "Signing out\u2026" : "Sign out"}
        </button>

        <p className="text-[12px] text-ink-45 mt-3">
          Sign out to use a different account.
        </p>
      </div>
    </main>
  );
}
