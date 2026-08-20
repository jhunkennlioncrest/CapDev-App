import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveSpeakersInText } from "@/lib/speakers";
import { useSpeakers } from "@/lib/useSpeakers";
import { supabase } from "@/lib/supabase";
import { formatDuration, formatDate } from "@/lib/format";
import { MOMENT_TYPES, type Moment, type MomentType } from "@/lib/moments";
import { getActiveRubric, type Criterion } from "@/lib/evaluation";
import { signedUrlFor } from "@/lib/calls";

interface Props {
  onOpenCall: (id: string) => void;
  onBack: () => void;
  embedded?: boolean;
}

interface LibraryMoment extends Moment {
  storage_path: string | null;
}

/**
 * The moment library.
 *
 * Deliberately search-first: someone opens this because they have a situation
 * in mind, not because they want to browse. Filters are secondary.
 */
export function MomentLibrary({ onOpenCall, onBack, embedded = false }: Props): JSX.Element {
  const [moments, setMoments] = useState<LibraryMoment[] | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<MomentType | null>(null);
  const [criterionFilter, setCriterionFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [{ data, error: err }, rubric] = await Promise.all([
        supabase
          .from("v_moment_list")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(300),
        getActiveRubric(),
      ]);
      if (err) throw new Error(err.message);
      setMoments((data ?? []) as LibraryMoment[]);
      setCriteria((rubric?.sections ?? []).flatMap((s) => s.criteria));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const codeById = useMemo(
    () => Object.fromEntries(criteria.map((c) => [c.id, c.code])),
    [criteria],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (moments ?? []).filter((m) => {
      if (typeFilter && m.moment_type !== typeFilter) return false;
      if (criterionFilter && !m.criterion_ids.includes(criterionFilter)) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.coaching_note.toLowerCase().includes(q) ||
        m.excerpt.toLowerCase().includes(q) ||
        (m.call_title ?? "").toLowerCase().includes(q) ||
        (m.agent_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [moments, query, typeFilter, criterionFilter]);

  const totalMs = visible.reduce((sum, m) => sum + m.duration_ms, 0);

  return (
    <div className={embedded ? "max-w-6xl mx-auto px-6 pb-20" : "max-w-5xl mx-auto px-6 pb-20"}>
{!embedded && (
      <header className="pt-8 pb-5 border-b border-rule">
        <button
          onClick={onBack}
          className="text-[13px] text-ink-45 hover:text-ink underline underline-offset-2"
        >
          &larr; All calls
        </button>
        <h1 className="font-display text-3xl mt-3">Moment library</h1>
        <p className="text-ink-70 text-[14px] mt-1 max-w-2xl">
          The clips worth showing someone. Saved while evaluating, reusable for
          coaching any rep.
        </p>
      </header>
      )}

      {error && <p className="mt-5 text-[13px] text-[#AC3A2A]">{error}</p>}

      <div className="mt-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search moments — a phrase, a rep, a situation"
          className="w-full border border-rule rounded px-3.5 py-2.5 bg-white text-[15px]
                     focus:outline-none focus:ring-2 focus:ring-accent"
        />

        <div className="flex gap-1.5 flex-wrap mt-3">
          {MOMENT_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTypeFilter(typeFilter === t.value ? null : t.value)}
              title={t.hint}
              className={`border rounded-full px-3 py-1 text-[12.5px] ${
                typeFilter === t.value
                  ? "bg-ink text-ground border-ink"
                  : "border-rule hover:bg-ground-2"
              }`}
            >
              {t.label}
            </button>
          ))}
          <span className="w-px bg-rule mx-1.5" />
          {criteria.map((c) => (
            <button
              key={c.id}
              onClick={() => setCriterionFilter(criterionFilter === c.id ? null : c.id)}
              title={c.statement}
              className={`border rounded-full px-2.5 py-1 font-mono text-[11px] ${
                criterionFilter === c.id
                  ? "bg-ink text-ground border-ink"
                  : "border-rule hover:bg-ground-2"
              }`}
            >
              {c.code}
            </button>
          ))}
        </div>
      </div>

      {moments !== null && moments.length > 0 && (
        <p className="font-mono text-[11.5px] text-ink-45 mt-5">
          {visible.length} moment{visible.length === 1 ? "" : "s"}
          {visible.length > 0 && ` · ${formatDuration(totalMs)} of clips`}
          {(typeFilter || criterionFilter || query) && ` · filtered from ${moments.length}`}
        </p>
      )}

      <div className="mt-4">
        {moments === null ? (
          <p className="text-ink-45 text-sm">Loading&hellip;</p>
        ) : moments.length === 0 ? (
          <div className="border border-dashed border-rule rounded bg-card px-8 py-12 text-center">
            <h2 className="font-display text-2xl mb-2">No moments yet</h2>
            <p className="text-ink-70 max-w-md mx-auto">
              While evaluating a call, quote a line from the transcript and tick
              &ldquo;also save as a teaching moment&rdquo;. Those clips collect here.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="border border-dashed border-rule rounded bg-card px-8 py-10 text-center">
            <p className="text-ink-70">Nothing matches that.</p>
            <button
              onClick={() => {
                setQuery("");
                setTypeFilter(null);
                setCriterionFilter(null);
              }}
              className="mt-3 border border-rule rounded px-3.5 py-1.5 text-[13px] hover:bg-ground-2"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {visible.map((m) => (
              <MomentCard
                key={m.id}
                moment={m}
                codeById={codeById}
                onOpenCall={() => onOpenCall(m.call_id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MomentCard({
  moment,
  codeById,
  onOpenCall,
}: {
  moment: LibraryMoment;
  codeById: Record<string, string>;
  onOpenCall: () => void;
}): JSX.Element {
  const speakers = useSpeakers(moment.call_id);
  const [url, setUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);

  const type = MOMENT_TYPES.find((t) => t.value === moment.moment_type);
  const colour =
    moment.moment_type === "model"
      ? "#1F7A4D"
      : moment.moment_type === "recovery"
        ? "#2C6E9B"
        : moment.moment_type === "miss"
          ? "#AC3A2A"
          : "#96690A";

  async function play(): Promise<void> {
    if (!moment.storage_path || url) return;
    setLoadingUrl(true);
    setUrl(await signedUrlFor(moment.storage_path));
    setLoadingUrl(false);
  }

  return (
    <li className="bg-card border border-rule-soft rounded px-4 py-3.5">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <h3 className="font-display text-lg">{moment.title}</h3>
            <span
              className="text-[11px] font-medium border rounded-full px-2 py-0.5"
              style={{ color: colour, borderColor: colour }}
            >
              {type?.label ?? moment.moment_type}
            </span>
          </div>
          <p className="text-[12px] text-ink-45 mt-0.5">
            {moment.agent_name || "Rep not set"} &middot; {moment.call_title} &middot;{" "}
            {formatDate(moment.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-[12px] text-ink-70">
            {formatDuration(moment.start_ms)}–{formatDuration(moment.end_ms)}
          </span>
          {moment.storage_path && (
            <button
              onClick={() => void play()}
              disabled={loadingUrl || !!url}
              className="border border-rule rounded px-3 py-1.5 text-[13px] hover:bg-ground-2 disabled:opacity-40"
            >
              {loadingUrl ? "Opening…" : url ? "Playing" : "Listen"}
            </button>
          )}
          <button
            onClick={onOpenCall}
            className="border border-rule rounded px-3 py-1.5 text-[13px] hover:bg-ground-2"
          >
            Open call
          </button>
        </div>
      </div>

      {moment.coaching_note && (
        <p className="text-[13.5px] text-ink-70 mt-2.5">{moment.coaching_note}</p>
      )}

      {moment.excerpt && (
        <p className="text-[12.5px] text-ink-70 mt-2 border-l-2 border-rule pl-3 whitespace-pre-line">
          {resolveSpeakersInText(moment.excerpt, speakers)}
        </p>
      )}

      {moment.criterion_ids.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-2.5">
          {moment.criterion_ids.map((id) => (
            <span
              key={id}
              className="font-mono text-[10.5px] bg-ground-2 text-ink-70 px-2 py-0.5 rounded"
            >
              {codeById[id] ?? "—"}
            </span>
          ))}
        </div>
      )}

      {url && (
        <ClipPlayer url={url} startMs={moment.start_ms} endMs={moment.end_ms} />
      )}
    </li>
  );
}


/**
 * Plays exactly the clip, not the call.
 *
 * The `#t=start,end` media fragment is unreliable — Safari ignores the end
 * bound entirely and Chrome drops it on signed URLs carrying query strings.
 * So the boundaries are enforced here: seek on load, and pause on reaching the
 * end. Scrubbing outside the clip is pulled back rather than blocked, so the
 * control still feels like an audio player rather than a locked box.
 */
function ClipPlayer({
  url,
  startMs,
  endMs,
}: {
  url: string;
  startMs: number;
  endMs: number;
}): JSX.Element {
  const ref = useRef<HTMLAudioElement>(null);
  const [position, setPosition] = useState(startMs);

  const startSec = startMs / 1000;
  const endSec = endMs / 1000;

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;

    const begin = (): void => {
      audio.currentTime = startSec;
      void audio.play();
    };

    if (audio.readyState >= 1) begin();
    else audio.addEventListener("loadedmetadata", begin, { once: true });

    return () => audio.removeEventListener("loadedmetadata", begin);
  }, [url, startSec]);

  function onTime(e: React.SyntheticEvent<HTMLAudioElement>): void {
    const audio = e.currentTarget;
    if (audio.currentTime >= endSec) {
      audio.pause();
      audio.currentTime = startSec;
    } else if (audio.currentTime < startSec - 0.5) {
      // Dragged before the clip — return to its start.
      audio.currentTime = startSec;
    }
    setPosition(audio.currentTime * 1000);
  }

  const elapsed = Math.max(0, position - startMs);
  const length = endMs - startMs;
  const progress = length > 0 ? Math.min(100, (elapsed / length) * 100) : 0;

  return (
    <div className="mt-3">
      <audio ref={ref} controls src={url} onTimeUpdate={onTime} className="w-full" />
      <div className="flex items-center gap-2.5 mt-1.5">
        <span className="font-mono text-[11px] text-ink-45 tabular-nums">
          {formatDuration(elapsed)} / {formatDuration(length)}
        </span>
        <span className="flex-1 h-1 bg-ground-2 rounded overflow-hidden">
          <span className="block h-full bg-ink" style={{ width: `${progress}%` }} />
        </span>
        <span className="font-mono text-[11px] text-ink-45">clip only</span>
      </div>
    </div>
  );
}
