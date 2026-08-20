import { useState } from "react";
import { SubNav } from "@/components/AppShell";
import { MomentLibrary } from "@/pages/MomentLibrary";
import { QualityRepository } from "@/pages/QualityRepository";
import { LibraryHome } from "@/pages/LibraryHome";
import { CaseStudies } from "@/pages/CaseStudies";
import { KnowledgeArticles } from "@/pages/KnowledgeArticles";
import type { Session } from "@/lib/types";

// Learning Playlists are PARKED, not removed. The tables, migrations and the
// LearningPlaylists page all remain; they are simply out of the Library while
// the distinction from a Case Study is not yet worth a separate layer. When
// ordered learning paths are actually needed — onboarding, a training course,
// a curriculum — a playlist becomes a sequence rather than another container,
// and this tab comes back. See docs/parked-learning-playlists.md.
type Tab = "home" | "moments" | "evaluations" | "casestudies" | "knowledge";

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
  const [tab, setTab] = useState<Tab>("home");
  const [openStudy, setOpenStudy] = useState<string | null>(null);
  const [openArticle, setOpenArticle] = useState<string | null>(null);

  return (
    <div>
      <div className="max-w-6xl mx-auto px-6 pt-8">
        <h1 className="font-display text-3xl">Library</h1>
        <p className="text-ink-70 text-[14px] mt-1 mb-5 max-w-xl">
          What the organisation has learned, kept where people can find it.
        </p>
        <SubNav
          tabs={[
            { key: "home" as const, label: "Overview" },
            { key: "moments" as const, label: "Teaching moments" },
            { key: "evaluations" as const, label: "Completed evaluations" },
            { key: "casestudies" as const, label: "Case studies" },
            { key: "knowledge" as const, label: "Knowledge articles" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === "home" && (
        <LibraryHome
          onOpenTab={setTab}
          onOpenCall={onOpenCall}
          onOpenRecord={onOpenRecord}
          onOpenCaseStudy={(id) => {
            setOpenStudy(id);
            setTab("casestudies");
          }}
          onOpenArticle={(id) => {
            setOpenArticle(id);
            setTab("knowledge");
          }}
        />
      )}
      {tab === "moments" && <MomentLibrary onOpenCall={onOpenCall} onBack={() => setTab("moments")} embedded />}
      {tab === "evaluations" && (
        <QualityRepository onOpenRecord={onOpenRecord} onBack={() => setTab("moments")} embedded />
      )}
      {tab === "casestudies" && (
        <CaseStudies session={session} openId={openStudy} onOpen={setOpenStudy} />
      )}
      {tab === "knowledge" && (
        <KnowledgeArticles session={session} openId={openArticle} onOpen={setOpenArticle} />
      )}
    </div>
  );
}
