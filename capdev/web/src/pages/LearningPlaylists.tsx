import { useCallback, useEffect, useState } from "react";
import {
  addCallToPlaylist,
  createLearningPlaylist,
  getPlaylistContents,
  listPlaylists,
  type PlaylistCall,
  type PlaylistSummary,
} from "@/lib/playlists";
import { listRepository, type RepositoryRow } from "@/lib/repository";
import { formatDate } from "@/lib/format";
import type { Session } from "@/lib/types";

/**
 * Learning playlists — curated, never automatic.
 *
 * Raw QA playlists build themselves because they record work that happened.
 * These are chosen: a set of calls someone decided is worth discussing. Auto-
 * populating them would turn the library into a second repository.
 */
export function LearningPlaylists({
  session,
  onOpenCall,
}: {
  session: Session;
  onOpenCall: (id: string) => void;
}): JSX.Element {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [contents, setContents] = useState<Record<string, PlaylistCall[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [completed, setCompleted] = useState<RepositoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setPlaylists(await listPlaylists("learning"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(): Promise<void> {
    if (!name.trim()) return;
    try {
      await createLearningPlaylist({
        orgId: session.person.org_id,
        personId: session.person.id,
        name,
      });
      setName("");
      setCreating(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggle(id: string): Promise<void> {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!contents[id]) {
      const rows = await getPlaylistContents(id);
      setContents((c) => ({ ...c, [id]: rows }));
    }
  }

  async function openAdd(playlistId: string): Promise<void> {
    setAdding(playlistId);
    if (completed.length === 0) setCompleted(await listRepository());
  }

  async function add(playlistId: string, callId: string): Promise<void> {
    await addCallToPlaylist(playlistId, callId, session.person.id);
    setContents((c) => {
      const next = { ...c };
      delete next[playlistId];
      return next;
    });
    const rows = await getPlaylistContents(playlistId);
    setContents((c) => ({ ...c, [playlistId]: rows }));
    await load();
  }

  return (
    <div className="max-w-6xl mx-auto px-6 pb-20">
      <div className="flex justify-between items-start gap-4 flex-wrap mb-4">
        <p className="text-[13px] text-ink-70 max-w-xl">
          Sets of calls chosen for a purpose &mdash; a calibration meeting, an
          onboarding session, a coaching conversation.
        </p>
        <button
          onClick={() => setCreating(true)}
          className="border border-rule rounded px-3.5 py-2 text-sm hover:bg-ground-2"
        >
          New playlist
        </button>
      </div>

      {error && <p className="text-[13px] text-[#AC3A2A] mb-3">{error}</p>}

      {creating && (
        <div className="bg-card border border-rule-soft rounded px-4 py-3.5 mb-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Onboarding — strong openings"
            className="w-full border border-rule rounded px-2.5 py-2 bg-white text-sm mb-2.5"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void create()}
              disabled={!name.trim()}
              className="bg-ink text-ground border border-ink rounded px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-40"
            >
              Create
            </button>
            <button
              onClick={() => setCreating(false)}
              className="border border-rule rounded px-3.5 py-1.5 text-[13px] hover:bg-ground-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {playlists.length === 0 ? (
        <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
          <h2 className="font-display text-2xl mb-2">No playlists yet</h2>
          <p className="text-ink-70 max-w-md mx-auto">
            Make one for your next calibration meeting, then add completed
            evaluations worth discussing.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {playlists.map((p) => (
            <li key={p.id} className="bg-card border border-rule-soft rounded">
              <button
                onClick={() => void toggle(p.id)}
                className="w-full px-4 py-3.5 flex justify-between items-center gap-4 text-left"
              >
                <div className="min-w-0">
                  <h3 className="font-display text-lg">{p.name}</h3>
                  <p className="text-[12px] text-ink-45 mt-0.5">
                    {p.call_count} call{p.call_count === 1 ? "" : "s"} &middot; by{" "}
                    {p.author_name ?? "—"} &middot; {formatDate(p.created_at)}
                  </p>
                </div>
                <span className="text-[12px] text-ink-45 shrink-0">
                  {expanded === p.id ? "Hide" : "Open"}
                </span>
              </button>

              {expanded === p.id && (
                <div className="border-t border-rule-soft">
                  <ul className="divide-y divide-rule-soft">
                    {(contents[p.id] ?? []).map((c) => (
                      <li key={c.call_id} className="px-4 py-2.5 flex justify-between items-center gap-3">
                        <span className="text-[13.5px]">
                          {c.call_title}
                          <span className="text-ink-45 ml-2">{c.agent_name}</span>
                        </span>
                        <span className="flex items-center gap-3">
                          {c.overall_score !== null && (
                            <span className="font-mono text-[11.5px] text-ink-45">
                              {c.overall_score}%
                            </span>
                          )}
                          <button
                            onClick={() => onOpenCall(c.call_id)}
                            className="border border-rule rounded px-3 py-1 text-[12.5px] hover:bg-ground-2"
                          >
                            Open
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="px-4 py-3">
                    {adding === p.id ? (
                      <div>
                        <p className="text-[12px] text-ink-45 mb-2">
                          Completed evaluations &mdash; pick one to add.
                        </p>
                        <ul className="max-h-56 overflow-auto border border-rule-soft rounded divide-y divide-rule-soft">
                          {completed.map((r) => (
                            <li
                              key={r.call_id}
                              className="px-3 py-2 flex justify-between items-center gap-3"
                            >
                              <span className="text-[13px]">
                                {r.call_title}
                                <span className="text-ink-45 ml-2">
                                  {r.agent_name} · {r.overall_score}%
                                </span>
                              </span>
                              <button
                                onClick={() => void add(p.id, r.call_id)}
                                className="border border-rule rounded px-2.5 py-1 text-[12px] hover:bg-ground-2"
                              >
                                Add
                              </button>
                            </li>
                          ))}
                        </ul>
                        <button
                          onClick={() => setAdding(null)}
                          className="text-[12.5px] text-ink-45 underline underline-offset-2 mt-2"
                        >
                          Done
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => void openAdd(p.id)}
                        className="text-[12.5px] text-ink-45 underline underline-offset-2 hover:text-ink"
                      >
                        Add a completed evaluation
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
