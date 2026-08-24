import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { EnvironmentBadge } from "@/components/EnvironmentBadge";

type Mode = "choose" | "email" | "reset" | "sent";


/**
 * Two ways in, one identity model.
 *
 * Google remains for anyone on Workspace. Work email exists because the
 * company's mail is hosted by Zoho, and a Zoho mailbox cannot complete Google
 * OAuth — the mailbox host is irrelevant to Supabase, which authenticates the
 * address and password itself.
 *
 * Neither path grants access. Both produce an auth.users row, which the
 * existing trigger links to an already-invited person by email. Someone who
 * authenticates without an invitation reaches the no-access screen, exactly as
 * before.
 */
export function SignIn(): JSX.Element {
  const [mode, setMode] = useState<Mode>("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);


  async function withGoogle(): Promise<void> {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  async function withPassword(): Promise<void> {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (!err) return; // useSession picks it up from here.

    // Supabase distinguishes an unconfirmed address from a bad credential, and
    // so should we: "invalid password" would send someone hunting for a
    // mistake they did not make. Everything else stays deliberately vague, so
    // a wrong guess cannot reveal whether an address is registered.
    setError(
      /confirm/i.test(err.message)
        ? "Please confirm your email first — check your work email for the link."
        : "Invalid email or password.",
    );
  }

  async function sendReset(): Promise<void> {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    // Reported as sent either way: whether an address is registered is not
    // something an unauthenticated visitor should be able to test.
    if (err && !/rate|limit/i.test(err.message)) {
      setMode("sent");
      return;
    }
    if (err) {
      setError("Too many attempts. Try again in a few minutes.");
      return;
    }
    setMode("sent");
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
          <h1 className="font-display text-4xl mt-2 mb-8">Moment Library</h1>
        </div>

        {mode === "sent" ? (
          <>
            <h2 className="font-display text-2xl mb-2">Check your work email</h2>
            <p className="text-[13.5px] text-ink-70 mb-5">
              If that address belongs to an account, we&rsquo;ve sent a link to
              set a new password. It may take a minute to arrive.
            </p>
            <button
              onClick={() => {
                setMode("email");
                setError(null);
              }}
              className={secondaryClass}
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <button onClick={() => void withGoogle()} className={primaryClass}>
              Continue with Google
            </button>

            <div className="flex items-center gap-3 my-5">
              <span className="h-px bg-rule flex-1" />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-45">
                or
              </span>
              <span className="h-px bg-rule flex-1" />
            </div>

            <Field label="Work email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="username"
                className={inputClass}
              />
            </Field>

            {mode !== "reset" && (
              <Field label="Password">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && email && password) void withPassword();
                  }}
                  className={inputClass}
                />
              </Field>
            )}

            {error && <Message tone="error">{error}</Message>}

            {mode === "reset" ? (
              <>
                <button
                  onClick={() => void sendReset()}
                  disabled={busy || !email.trim()}
                  className={primaryClass}
                >
                  {busy ? "Sending\u2026" : "Send reset link"}
                </button>
                <button
                  onClick={() => {
                    setMode("email");
                    setError(null);
                  }}
                  className="w-full text-[12.5px] text-ink-45 underline underline-offset-2 mt-3 hover:text-ink"
                >
                  Back
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => void withPassword()}
                  disabled={busy || !email.trim() || !password}
                  className={primaryClass}
                >
                  {busy ? "Signing in\u2026" : "Sign in"}
                </button>
                <button
                  onClick={() => {
                    setMode("reset");
                    setError(null);
                  }}
                  className="w-full text-[12.5px] text-ink-45 underline underline-offset-2 mt-3 hover:text-ink"
                >
                  Forgot password?
                </button>
              </>
            )}

            {/* No "create account" button, deliberately: an administrator
                invites people, and authenticating without an invitation
                reaches the no-access screen. */}
            <p className="text-[11.5px] text-ink-45 text-center mt-6">
              Accounts are created by an administrator.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

const inputClass =
  "w-full border border-rule rounded px-3 py-2 bg-white text-[14px] focus:outline-none focus:border-ink";

const primaryClass =
  "w-full bg-ink text-ground border border-ink rounded px-4 py-2.5 font-medium hover:opacity-85 transition-opacity disabled:opacity-40";

const secondaryClass =
  "w-full border border-rule rounded px-4 py-2.5 text-[14px] hover:bg-ground-2";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="block mb-3">
      <span className="block text-[12px] font-semibold mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Message({
  tone,
  children,
}: {
  tone: "error" | "ok";
  children: React.ReactNode;
}): JSX.Element {
  return (
    <p
      className="text-[12.5px] mb-3"
      style={{ color: tone === "error" ? "#AC3A2A" : "#1F7A4D" }}
    >
      {children}
    </p>
  );
}
