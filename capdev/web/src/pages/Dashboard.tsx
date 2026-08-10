import type { Session } from "@/lib/types";
import { supabase } from "@/lib/supabase";

/**
 * M1 lands here deliberately empty. Assigned evaluations arrive in M6;
 * building the list before evaluations exist would be building against
 * an imagined shape.
 */
export function Dashboard({ session }: { session: Session }): JSX.Element {
  const first = session.person.display_name.split(" ")[0] || "there";

  return (
    <div className="max-w-5xl mx-auto px-6 pb-16">
      <header className="pt-9 pb-6 border-b border-rule flex justify-between items-start gap-6">
        <div>
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-45">
            Capability &amp; Development
          </p>
          <h1 className="font-display text-4xl mt-2">Good to see you, {first}</h1>
        </div>
        <button
          onClick={() => void supabase.auth.signOut()}
          className="mt-1 border border-rule rounded px-3 py-1.5 text-sm
                     text-ink hover:bg-ground-2 transition-colors"
        >
          Sign out
        </button>
      </header>

      <div className="mt-10 border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
        <h2 className="font-display text-2xl mb-2">Nothing assigned yet</h2>
        <p className="text-ink-70 max-w-md mx-auto">
          Evaluations will appear here once calls are uploaded. Upload arrives in
          the next milestone.
        </p>
      </div>
    </div>
  );
}
