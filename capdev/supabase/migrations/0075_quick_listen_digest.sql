-- 0075_quick_listen_digest.sql
--
-- Quick Listen — data foundation only (0075 Phase 1).
--
-- One additive table. No function is created or altered, no existing row is
-- touched, no provider is called and no secret lives here. The Edge Function
-- that fills this table is Phase 2 and does not exist yet.
--
-- Quick Listen is an AI-condensed re-voicing of a long call, offered as a
-- review aid. The original recording and its transcript remain the source of
-- truth for every QA decision; nothing in this table ever supersedes them.
--
--
-- REVERSAL (in concept — not run here)
--
--   drop table if exists public.call_digest;
--
-- The table is additive and nothing else references it, so dropping it
-- restores the pre-0075 schema exactly. Storage objects written by later
-- phases are not in the database and would have to be removed separately.


-- ---------------------------------------------------------------------------
-- The digest.
--
-- One row per generation attempt, not one row per call. A call may accumulate
-- several: a failed attempt, a superseded one from before the transcript was
-- corrected, and the current one. Nothing here enforces a single READY digest
-- per call, deliberately — Phase 3 needs stale and current digests to coexist
-- so a reviewer can be told the Quick Listen is out of date rather than
-- finding it silently gone.
--
-- FOREIGN KEY ACTIONS — chosen from the live purge path, not by preference.
--
--   public.delete_unsubmitted_call() (0066) deletes a call's children by hand,
--   one statement per table, in dependency order, because "every foreign key
--   to call is NO ACTION". call_digest is not in that list and Phase 1 is
--   forbidden from editing it. A NO ACTION reference from here would therefore
--   make that function throw the moment any digest existed — a shipped feature
--   (Raw QA deleting their own unsubmitted upload) broken by an additive
--   migration. So call_id CASCADEs, matching risk_record, which the 0066
--   comment already records as the CASCADE exception.
--
--   transcript_id CASCADEs for the same mechanical reason: that function runs
--   `delete from public.transcript where call_id = ...` BEFORE it deletes the
--   call, so a NO ACTION reference to transcript would throw one statement
--   earlier. It is also right on the merits — the digest is derived from one
--   exact transcript, and without that transcript its provenance is
--   unverifiable. Nothing else in the schema hard-deletes a transcript;
--   re-transcription supersedes (supersedes_id) rather than deleting.
--
--   Both were tested, not assumed: replaying the whole delete_unsubmitted_call
--   body against a call carrying a digest succeeds as written here, and fails
--   with 23503 at the transcript step when the same references are NO ACTION.
--
--   rubric_version_id and created_by are plain NO ACTION references, matching
--   evaluation.rubric_version_id and moment.created_by. Neither rubric
--   versions nor people are ever hard-deleted; they archive.
--
--   org_id is a plain reference, matching call, transcript, recording and
--   moment. Organizations are not deleted.
--
-- WHAT THIS DOES NOT SOLVE: the cascade removes ROWS. The generated audio
-- lives in storage, which SQL cannot reach, and 0066 hands storage paths back
-- to the client for exactly that reason. Phase 4/5 must extend
-- authorize_call_purge() to return Quick Listen paths too. Until it does, a
-- purged call leaves its Quick Listen objects orphaned in the bucket. This is
-- recorded here so it cannot be forgotten.

create table if not exists public.call_digest (
  id                  uuid primary key default uuid_v7(),
  org_id              uuid not null references public.organization(id),
  call_id             uuid not null references public.call(id) on delete cascade,
  transcript_id       uuid not null references public.transcript(id) on delete cascade,

  -- Provenance of the source state this digest was built from. Phase 3
  -- computes it; Phase 1 only reserves it. See the comment on the column.
  source_fingerprint  text not null check (length(btrim(source_fingerprint)) > 0),
  rubric_version_id   uuid references public.rubric_version(id),

  -- No default, on purpose. A default would let a future generation path
  -- insert without stating which prompt it used, and the row would still look
  -- well-formed. The writer must say.
  prompt_version      text not null check (length(btrim(prompt_version)) > 0),

  -- Also no default: 'queued' is the only sane opening state, but a default
  -- would let a writer create a row without declaring what it is creating.
  status              text not null
                        check (status in ('queued','running','ready','failed')),

  -- Ordered Quick Listen lines. Shape guarded only as "an array" — the same
  -- guard transcript.segments carries. The full per-line shape is validated by
  -- the generator, not by SQL.
  script              jsonb check (script is null or jsonb_typeof(script) = 'array'),

  storage_path        text,
  chunk_paths         text[],

  duration_ms         integer check (duration_ms is null or duration_ms >= 0),
  word_count          integer check (word_count is null or word_count >= 0),
  line_count          integer check (line_count is null or line_count >= 0),

  voice_map           jsonb check (voice_map is null or jsonb_typeof(voice_map) = 'object'),

  condense_provider   text,
  condense_model      text,

  tts_provider        text,
  tts_model           text,
  tts_request_count   integer check (tts_request_count is null or tts_request_count >= 0),
  tts_character_count integer check (tts_character_count is null or tts_character_count >= 0),

  seed                bigint,

  attempt             integer not null default 0 check (attempt >= 0),
  error_message       text,

  requested_at        timestamptz not null default now(),
  started_at          timestamptz,
  finished_at         timestamptz,

  created_by          uuid references public.person(id),
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.call_digest is
  '0075: one Quick Listen generation attempt per row — an AI-condensed re-voicing of a long call, offered as a review aid. The original recording and transcript remain authoritative. Readable by anyone in the org with call.read; written only by the service-role Edge Function, which has no RLS policy here and does not need one.';


-- ---------------------------------------------------------------------------
-- The provenance contract.
--
-- Written into the schema now, before any UI exposes it, because provenance
-- that is added later is provenance that was never captured for the rows that
-- already exist.

comment on column public.call_digest.script is
$c$0075: ordered Quick Listen lines. Each element is approximately:

  {
    n,                 -- 1-based position in the condensed script
    speaker_label,     -- label as it appears in the source transcript
    name,              -- resolved speaker name at generation time
    role,              -- resolved speaker role at generation time
    text,              -- the condensed line, grounded in the transcript
    source_i,          -- [int] source segment indexes this line came from
    source_start_ms,   -- span in the ORIGINAL recording's timeline
    source_end_ms,
    audio_start_ms,    -- span in the GENERATED Quick Listen audio
    audio_end_ms
  }

source_i / source_start_ms / source_end_ms are the whole point: every condensed
line can be traced back to the original audio it was drawn from, so a reviewer
can always check the claim against the real call. The UI does not expose this
in Phase 3; it is stored from the first generated row regardless.

audio_start_ms / audio_end_ms are offsets into the SEPARATE Quick Listen audio
element. They must never be fed to the original player: evidence, moments and
transcript follow-along are all anchored to the original timeline.

Not validated beyond jsonb_typeof = 'array'. The generator owns the shape.$c$;

comment on column public.call_digest.source_fingerprint is
  '0075: authoritative source state this digest was built from. Phase 3 computes it over the authoritative transcript id, its version_no, its updated/reviewed state, the speaker names and roles in effect, and the transcript segment count. The digest is STALE when the fingerprint recomputed from current state differs from this value. Staleness is reported, never auto-corrected: regeneration stays a manual act.';

comment on column public.call_digest.prompt_version is
  '0075: identifier of the prompt/generation contract that produced this row, e.g. 0075-p1. Deliberately has no database default — the generating code must write the version it actually used, so a change of prompt is visible per row rather than inferred.';

comment on column public.call_digest.storage_path is
  '0075: object path of the assembled Quick Listen audio. SQL cannot reach storage; permanent deletion of the object is the caller''s job (see authorize_call_purge in 0066).';

comment on column public.call_digest.chunk_paths is
  '0075: per-request TTS objects assembled into storage_path, kept so a failed assembly can be retried without re-billing every line. Same storage caveat as storage_path.';

comment on column public.call_digest.status is
  '0075: queued -> running -> ready | failed. No default: the writer states the state it is creating.';


-- ---------------------------------------------------------------------------
-- Indexes.
--
-- Latest digest for a call, including archived ones. Not partial on
-- archived_at: this is a history table and an archived digest still has to be
-- findable, the same reasoning as call_identity_backup_call_idx.

create index if not exists call_digest_call_recent_idx
  on public.call_digest (call_id, requested_at desc);

-- One generation in flight per call, enforced by the database rather than by
-- whoever remembers to check first. Two reviewers pressing Generate at the
-- same moment, or a retry racing a running job, must not both bill a provider.
--
-- Keyed on call_id alone. call.id is a globally unique uuid_v7 and call_id
-- references it, so org_id is functionally dependent on it — adding org_id
-- would not narrow anything, and would silently WIDEN the guard by making two
-- rows with the same call_id under different org_ids acceptable.
--
-- Only in-flight rows. Any number of finished digests may coexist for a call:
-- historical READY rows are expected, not an error.

create unique index if not exists call_digest_one_in_flight_per_call
  on public.call_digest (call_id)
  where status in ('queued','running') and archived_at is null;


-- ---------------------------------------------------------------------------
-- updated_at, the house trigger.

drop trigger if exists call_digest_set_updated_at on public.call_digest;
create trigger call_digest_set_updated_at
  before update on public.call_digest
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- RLS.
--
-- Read only, and only inside the reader's own organisation, gated on the same
-- permission that gates the call itself: someone who cannot read the call must
-- not read a condensed version of it.
--
-- There is deliberately NO insert, update or delete policy. RLS denies any
-- command with no permissive policy, so the blanket Supabase grants that every
-- table in this schema carries do not let an authenticated client write here —
-- the same arrangement audit_event has used since 0004, where rows arrive from
-- privileged code rather than from the API. The Phase 2 Edge Function writes
-- as service_role, which bypasses RLS and needs no policy.

alter table public.call_digest enable row level security;

drop policy if exists call_digest_read on public.call_digest;
create policy call_digest_read on public.call_digest
  for select using (
    org_id = public.current_org_id()
    and public.has_permission('call.read')
  );
