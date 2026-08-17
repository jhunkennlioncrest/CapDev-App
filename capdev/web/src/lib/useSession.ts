import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Person, Session } from "./types";

type State =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session }
  | { status: "no-access"; email: string };

/**
 * Resolves the Supabase auth user to their domain Person and permissions.
 *
 * A signed-in auth user with no matching active person is "no-access", not an
 * error: it means someone authenticated with Google but has not been invited.
 * Telling them that plainly is better than a blank screen.
 */
export function useSession(): State {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function resolve(): Promise<void> {
      const { data } = await supabase.auth.getSession();
      const authUser = data.session?.user;

      if (!authUser) {
        if (!cancelled) setState({ status: "signed-out" });
        return;
      }

      const lookup = async (): Promise<Person | null> => {
        const { data } = await supabase
          .from("person")
          .select("id, org_id, email, display_name, status")
          .eq("auth_user_id", authUser.id)
          .is("archived_at", null)
          .maybeSingle<Person>();
        return data;
      };

      let person = await lookup();

      // Nothing linked to this auth account yet. They may have been added after
      // they first opened the app, in which case the sign-in trigger never ran
      // for them. Claim by email, then look again.
      if (!person) {
        await supabase.rpc("claim_person");
        person = await lookup();
      }

      if (cancelled) return;

      if (!person || person.status !== "active") {
        setState({ status: "no-access", email: authUser.email ?? "" });
        return;
      }

      const { data: perms } = await supabase
        .from("v_my_permissions")
        .select("permission_code");

      setState({
        status: "signed-in",
        session: {
          person,
          permissions: (perms ?? []).map((p) => p.permission_code as string),
        },
      });
    }

    void resolve();
    const { data: sub } = supabase.auth.onAuthStateChange(() => void resolve());
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
