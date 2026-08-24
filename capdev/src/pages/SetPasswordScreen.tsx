import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { EnvironmentBadge } from "@/components/EnvironmentBadge";
import { completeSetup, type SetupKind } from "@/lib/accountSetup";

/**
 * Choosing a password, for an invitation or a reset.
 *
 * One component for both so the two cannot drift; only the wording differs.
 * It uses the session Supabase already established from the link — there is no
 * second authentication flow here, and updateUser writes to the identity the
 * user already has.
 *
 * No length rule lives here. Supabase owns the policy and its message is shown
 * verbatim; the hint below only tells the user what to aim for.
 */
export function SetPasswordScreen({
  kind,
  onDone,
}: {
  kind: SetupKind;
  onDone: () => void;
}): JSX.Element {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inviting = kind === "invite";

  async function save(): Promise<void> {
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      // Supabase's own wording — it knows the configured policy, we do not.
      setError(err.message);
      return;
    }
    // Only now is the setup genuinely finished.
    completeSetup();
    onDone();
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-45">
            Capability &amp; Development
          </p>
          <div className="mb-3">
            <EnvironmentBadge />
          </div>
        </div>

        <h1 className="font-display text-3xl mb-1">
          {inviting ? "Set your password" : "Reset your password"}
        </h1>
        <p className="text-[13.5px] text-ink-70 mb-1">
          {inviting
            ? "Create a password for your CapDev work account. You'll use it with your work email from now on."
            : "Choose a new password for your work email account."}
        </p>
        <p className="text-[12px] text-ink-45 mb-4">{PASSWORD_HINT}</p>

        <label className="block mb-3">
          <span className="block text-[12px] font-semibold mb-1.5">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
        <label className="block mb-3">
          <span className="block text-[12px] font-semibold mb-1.5">
            Confirm password
          </span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            onKeyDown={(e) => {
              if (e.key === "Enter" && password && confirm) void save();
            }}
            className={inputClass}
          />
        </label>

        {error && (
          <p className="text-[12.5px] mb-3" style={{ color: "#AC3A2A" }}>
            {error}
          </p>
        )}

        <button
          onClick={() => void save()}
          disabled={busy || !password || !confirm}
          className="w-full bg-ink text-ground border border-ink rounded px-4 py-2.5
                     font-medium hover:opacity-85 transition-opacity disabled:opacity-40"
        >
          {busy ? "Saving\u2026" : inviting ? "Set password" : "Save new password"}
        </button>

        {/* A way out that does not strand anyone: signing out clears the
            session and returns them to a normal sign-in screen. */}
        <button
          onClick={() => {
            completeSetup();
            void supabase.auth.signOut();
          }}
          className="w-full text-[12px] text-ink-45 underline underline-offset-2 mt-3 hover:text-ink"
        >
          Cancel and sign out
        </button>
      </div>
    </main>
  );
}

/**
 * What Supabase will accept. Not enforced here — stated so the user is not
 * left to discover it through an error. Set VITE_PASSWORD_HINT per project if
 * the policy differs from the default.
 */
const PASSWORD_HINT =
  (import.meta.env.VITE_PASSWORD_HINT as string | undefined) ??
  "At least 6 characters.";

const inputClass =
  "w-full border border-rule rounded px-3 py-2 bg-white text-[14px] focus:outline-none focus:border-ink";
