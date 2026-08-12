import { useState } from "react";
import { useSession } from "@/lib/useSession";
import { SignIn } from "@/pages/SignIn";
import { NoAccess } from "@/pages/NoAccess";
import { Dashboard } from "@/pages/Dashboard";
import { CallDetail } from "@/pages/CallDetail";

export default function App(): JSX.Element {
  const state = useSession();
  const [openCallId, setOpenCallId] = useState<string | null>(null);

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
      return openCallId ? (
        <CallDetail
          callId={openCallId}
          session={state.session}
          onBack={() => setOpenCallId(null)}
        />
      ) : (
        <Dashboard session={state.session} onOpenCall={setOpenCallId} />
      );
  }
}
