-- 0072 · Original upload filename as traceability metadata
--
-- Second migration of the 0071 package (0071 was the canonical call date).
--
-- The generated call title answers "whose call was this, and when". It cannot
-- answer "which file did I upload", and reviewers need that: it is how a call
-- in this application is matched back to the recording in Zoom, in a shared
-- drive, or in an email. The filename is reference metadata and nothing more —
-- it never becomes the title, never names the representative or the author,
-- and never exposes a storage path.
--
-- WHY A NEW VIEW RATHER THAN EDITING THE EXISTING ONES
--
-- Five surfaces need this, backed by five views: v_raw_qa_worklist,
-- v_playlist_contents, v_call_list, v_calibration_queue and
-- v_quality_repository. Four of those five have no source in this repository —
-- migrations 0007 to 0065 are not here — so recreating them would mean writing
-- migration text reverse-engineered from pg_get_viewdef(). That output does not
-- include reloptions, which is precisely how a security_invoker view in this
-- schema silently becomes a definer view and stops enforcing cross-org RLS.
-- Trading that risk for one extra indexed lookup per surface is not a close
-- call, so this migration adds one small view and leaves the other five alone.
-- Nothing about playback, RLS or existing semantics changes.
--
-- WHY AN AGGREGATE RATHER THAN LIMIT 1
--
-- The schema permits more than one recording per call. Both environments
-- happen to have exactly one for every call today, but a view that answers
-- with the first row would go on looking correct while quietly hiding the
-- others, and nobody would find out from the screen. It returns all of them,
-- and the surfaces say how many.
--
-- ORDERING RULE: created_at ascending, then id ascending.
-- created_at is the upload order and is what a reader expects. id breaks ties,
-- so the list is deterministic even for recordings written in the same
-- transaction — array_agg without an explicit order is not.
--
-- AVAILABILITY: non-archived AND availability = 'available'.
-- Note that has_recording in v_raw_qa_worklist tests archived_at only. Every
-- recording in both environments is currently 'available', so the two agree;
-- if an unavailable one ever appears, that call would show has_recording with
-- an empty filename list. That is left as it is deliberately — changing
-- has_recording would be a semantic change to a view this task has no business
-- touching.

create or replace view public.v_call_recording_files
with (security_invoker = true) as
  select
    r.call_id,
    r.org_id,
    array_agg(r.original_filename order by r.created_at, r.id) as recording_filenames,
    count(*)::integer                                          as recording_file_count
  from public.recording r
 where r.archived_at is null
   and r.availability = 'available'
 group by r.call_id, r.org_id;

comment on view public.v_call_recording_files is
  '0071/0072: original upload filenames per call, for traceability display only. Non-archived available recordings, ordered created_at then id. security_invoker: RLS on recording decides what the caller sees. Never a title source, never a storage path.';

-- Same posture as the rest of the schema: the app roles read it, nothing else.
grant select on public.v_call_recording_files to authenticated;
