import { useState } from "react";
import { useSession } from "@/lib/useSession";
import { AppShell, visibleWorkspaces, type Workspace } from "@/components/AppShell";
import { SignIn } from "@/pages/SignIn";
import { NoAccess } from "@/pages/NoAccess";
import { HomeDashboard } from "@/pages/HomeDashboard";
import { RawQAWorkspace } from "@/pages/RawQAWorkspace";
import { CalibrationWorkspace } from "@/pages/CalibrationWorkspace";
import { LibraryWorkspace } from "@/pages/LibraryWorkspace";
import { AdminWorkspace } from "@/pages/AdminWorkspace";
import { CallDetail } from "@/pages/CallDetail";
import { QualityRecord } from "@/pages/QualityRecord";

/**
 * Five workspaces, filtered by role. A call or a completed evaluation opens
 * over the workspace it was reached from, so closing it returns you where you
 * were rather than to a lifecycle stage.
 */
type Overlay = { kind: "call"; id: string } | { kind: "record"; id: string } | null;

export default function App(): JSX.Element {
  const state = useSession();
  const [workspace, setWorkspace] = useState<Workspace>("dashboard");
  const [overlay, setOverlay] = useState<Overlay>(null);

  if (state.status === "loading") {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      </main>
    );
  }
  if (state.status === "signed-out") return <SignIn />;
  if (state.status === "no-access") return <NoAccess email={state.email} />;

  const { session } = state;
  const allowed = visibleWorkspaces(session.permissions).map((w) => w.key);
  const active = allowed.includes(workspace) ? workspace : "dashboard";

  const openCall = (id: string): void => setOverlay({ kind: "call", id });
  const openRecord = (id: string): void => setOverlay({ kind: "record", id });
  const close = (): void => setOverlay(null);

  return (
    <AppShell
      session={session}
      active={active}
      onNavigate={(w) => {
        setOverlay(null);
        setWorkspace(w);
      }}
    >
      {overlay?.kind === "call" ? (
        <CallDetail callId={overlay.id} session={session} onBack={close} />
      ) : overlay?.kind === "record" ? (
        <QualityRecord
          callId={overlay.id}
          session={session}
          onBack={close}
          onOpenCall={openCall}
        />
      ) : active === "rawqa" ? (
        <RawQAWorkspace session={session} onOpenCall={openCall} />
      ) : active === "calibration" ? (
        <CalibrationWorkspace onOpenCall={openCall} />
      ) : active === "library" ? (
        <LibraryWorkspace
          session={session}
          onOpenCall={openCall}
          onOpenRecord={openRecord}
        />
      ) : active === "admin" ? (
        <AdminWorkspace session={session} />
      ) : (
        <HomeDashboard session={session} onNavigate={setWorkspace} />
      )}
    </AppShell>
  );
}
