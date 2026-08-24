import { useEffect, useState } from "react";
import { pendingSetup } from "@/lib/accountSetup";
import { SetPasswordScreen } from "@/pages/SetPasswordScreen";
import { RepPerformance } from "@/pages/RepPerformance";
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
import { EnvironmentMismatch } from "@/components/EnvironmentBadge";
import { verifyEnvironment, type EnvironmentCheck } from "@/lib/environment";
import { QualityRecord } from "@/pages/QualityRecord";

/**
 * Five workspaces, filtered by role. A call or a completed evaluation opens
 * over the workspace it was reached from, so closing it returns you where you
 * were rather than to a lifecycle stage.
 */
type Overlay = { kind: "call"; id: string } | { kind: "record"; id: string } | null;

export default function App(): JSX.Element {
  const state = useSession();
  const [envCheck, setEnvCheck] = useState<EnvironmentCheck | null>(null);

  // Before anything else: confirm this deployment is talking to the database it
  // expects. Working in the wrong environment is worse than not working.
  useEffect(() => {
    void verifyEnvironment().then(setEnvCheck);
  }, []);
  const [workspace, setWorkspace] = useState<Workspace>("dashboard");
  // Captured at module load, before Supabase cleared the hash.
  const [setup, setSetup] = useState(() => pendingSetup());
  // A sub-view of the Dashboard rather than a workspace: management
  // analytics do not belong in the operational navigation.
  const [repPerformance, setRepPerformance] = useState<{ open: boolean; repId?: string }>({
    open: false,
  });
  const [overlay, setOverlay] = useState<Overlay>(null);

  if (envCheck && !envCheck.ok) {
    return (
      <EnvironmentMismatch
        declared={envCheck.declared}
        actual={envCheck.actual ?? "unknown"}
      />
    );
  }

  if (!envCheck || state.status === "loading") {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="text-ink-45 text-sm">Loading&hellip;</p>
      </main>
    );
  }
  // Above the session checks, deliberately. An invite or recovery link gives
  // the user a real session, so every status below would wave them straight
  // into the application with no password ever set. Holding a session is not
  // the same as having finished setting one up.
  if (setup) {
    return (
      <SetPasswordScreen
        kind={setup}
        // Re-read once the password is saved: the same session is now a
        // completed account, and normal routing takes over.
        onDone={() => setSetup(null)}
      />
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
        <CalibrationWorkspace onOpenCall={openCall} session={session} />
      ) : active === "library" ? (
        <LibraryWorkspace
          session={session}
          onOpenCall={openCall}
          onOpenRecord={openRecord}
        />
      ) : active === "admin" ? (
        <AdminWorkspace session={session} />
      ) : (
        repPerformance.open ? (
          <RepPerformance
            initialRepId={repPerformance.repId ?? null}
            onBack={() => setRepPerformance({ open: false })}
            onOpenRecord={(callId) => {
              setRepPerformance({ open: false });
              openRecord(callId);
            }}
          />
        ) : (
          <HomeDashboard
            onOpenCall={openCall}
            session={session}
            onNavigate={setWorkspace}
            onOpenRepPerformance={(repId) => setRepPerformance({ open: true, repId })}
          />
        )
      )}
    </AppShell>
  );
}
