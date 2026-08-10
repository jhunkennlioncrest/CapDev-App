import { useSession } from "@/lib/useSession";
import { SignIn } from "@/pages/SignIn";
import { NoAccess } from "@/pages/NoAccess";
import { Dashboard } from "@/pages/Dashboard";

export default function App(): JSX.Element {
  const state = useSession();

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
      return <Dashboard session={state.session} />;
  }
}
