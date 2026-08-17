import { useState } from "react";
import { SubNav } from "@/components/AppShell";
import { MomentLibrary } from "@/pages/MomentLibrary";
import { QualityRepository } from "@/pages/QualityRepository";
import { LearningPlaylists } from "@/pages/LearningPlaylists";
import type { Session } from "@/lib/types";

type Tab = "moments" | "playlists" | "evaluations" | "casestudies" | "knowledge";

/**
 * The Library — the organisation's learning hub.
 *
 * The Quality Repository lives here as "Completed evaluations" rather than as
 * its own destination: it is what powers the library, not a place users
 * navigate to think about storage.
 */
export function LibraryWorkspace({
  session,
  onOpenCall,
  onOpenRecord,
}: {
  session: Session;
  onOpenCall: (id: string) => void;
  onOpenRecord: (id: string) => void;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>("moments");

  return (
    <div>
      <div className="max-w-6xl mx-auto px-6 pt-8">
        <h1 className="font-display text-3xl">Library</h1>
        <p className="text-ink-70 text-[14px] mt-1 mb-5 max-w-xl">
          What the organisation has learned, kept where people can find it.
        </p>
        <SubNav
          tabs={[
            { key: "moments" as const, label: "Teaching moments" },
            { key: "playlists" as const, label: "Learning playlists" },
            { key: "evaluations" as const, label: "Completed evaluations" },
            { key: "casestudies" as const, label: "Case studies" },
            { key: "knowledge" as const, label: "Knowledge articles" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === "moments" && <MomentLibrary onOpenCall={onOpenCall} onBack={() => setTab("moments")} embedded />}
      {tab === "playlists" && <LearningPlaylists session={session} onOpenCall={onOpenCall} />}
      {tab === "evaluations" && (
        <QualityRepository onOpenRecord={onOpenRecord} onBack={() => setTab("moments")} embedded />
      )}
      {tab === "casestudies" && (
        <Placeholder
          title="Case studies"
          body="Built from completed evaluations and their teaching moments. The data model is in place; the editor comes after Version 1.0."
        />
      )}
      {tab === "knowledge" && (
        <Placeholder
          title="Knowledge articles"
          body="Approved learning content, published to Notion. Arrives with the publishing milestone."
        />
      )}
    </div>
  );
}

function Placeholder({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <div className="border border-dashed border-rule rounded bg-card px-8 py-14 text-center">
        <h2 className="font-display text-2xl mb-2">{title}</h2>
        <p className="text-ink-70 max-w-md mx-auto">{body}</p>
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-ink-45 mt-4">
          Not yet built
        </p>
      </div>
    </div>
  );
}
