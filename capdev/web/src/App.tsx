import { useState } from "react";
import { useSession } from "@/lib/useSession";
import { SignIn } from "@/pages/SignIn";
import { NoAccess } from "@/pages/NoAccess";
import { Dashboard } from "@/pages/Dashboard";
import { CallDetail } from "@/pages/CallDetail";
import { MomentLibrary } from "@/pages/MomentLibrary";

type View =
  | { name: "calls" }
  | { name: "call"; id: string }
  | { name: "moments" };

export default function App(): JSX.Element {
  const state = useSession();
  const [view, setView] = useState<View>({ name: "calls" });

  switch (state.status) {
    case "loading":
      return (
        <main className="min-h-screen grid place-items-center">
          <p className="text-ink-45 text-sm">Loading&hellip;</p>
        </main>
      );
    case "signed-out":
      return <SignIn />;
    case "no-access":
      return <NoAccess email={state.email} />;
    case "signed-in":
      if (view.name === "call") {
        return (
          <CallDetail
            callId={view.id}
            session={state.session}
            onBack={() => setView({ name: "calls" })}
          />
        );
      }
      if (view.name === "moments") {
        return (
          <MomentLibrary
            onOpenCall={(id) => setView({ name: "call", id })}
            onBack={() => setView({ name: "calls" })}
          />
        );
      }
      return (
        <Dashboard
          session={state.session}
          onOpenCall={(id) => setView({ name: "call", id })}
          onOpenMoments={() => setView({ name: "moments" })}
        />
      );
  }
}
