-- 0067_worklist_created_by.sql
--
-- Exposes call.created_by on v_raw_qa_worklist so the To Review list can offer
-- Delete on the reviewer's own uploads without making them open the call first.
--
-- Append-only. The body below is the live definition VERBATIM, as returned by
-- pg_get_viewdef, with one line added: c.created_by, as the last output column.
-- No column is removed, renamed or retyped, so CREATE OR REPLACE is accepted,
-- no DROP ... CASCADE is needed, and a before/after diff of pg_get_viewdef
-- should show exactly that one added line and nothing else.
--
-- CRITICAL: `with (security_invoker = true)` is restated deliberately.
-- pg_get_viewdef() does NOT report reloptions, so a rebuild that copies its
-- output without this line silently turns the view into a definer view and
-- stops enforcing RLS across organisations.
--
-- No submission test is added. The view already filters workflow_status to the
-- pre-submission set, and authorize_call_purge() re-checks submitted_at
-- server-side and refuses regardless of what the list shows.

create or replace view public.v_raw_qa_worklist
with (security_invoker = true) as
 SELECT c.id AS call_id,
    c.title AS call_title,
    c.agent_name,
    c.duration_ms,
    c.created_at AS uploaded_at,
    c.workflow_status,
    t.id IS NOT NULL AS has_transcript,
    COALESCE(t.segment_count, 0) AS segment_count,
    rec.id IS NOT NULL AS has_recording,
    j.status AS transcription_status,
    e.id AS draft_evaluation_id,
    p.display_name AS reviewer_name,
        CASE
            WHEN rec.id IS NULL THEN 'needs_audio'::text
            WHEN j.status = ANY (ARRAY['queued'::text, 'running'::text]) THEN 'transcribing'::text
            WHEN j.status = 'failed'::text AND t.id IS NULL THEN 'transcription_failed'::text
            WHEN t.id IS NULL THEN 'needs_transcript'::text
            WHEN e.id IS NOT NULL THEN 'in_progress'::text
            ELSE 'ready'::text
        END AS next_step,
    c.created_by
   FROM call c
     LEFT JOIN LATERAL ( SELECT t2.id,
            t2.org_id,
            t2.call_id,
            t2.recording_id,
            t2.provider,
            t2.source_format,
            t2.original_filename,
            t2.language,
            t2.version_no,
            t2.status,
            t2.segments,
            t2.segment_count,
            t2.has_timing,
            t2.speaker_count,
            t2.plain_text,
            t2.created_at,
            t2.created_by,
            t2.updated_at,
            t2.updated_by,
            t2.archived_at,
            t2.search_vector,
            t2.kind,
            t2.supersedes_id,
            t2.provider_model,
            t2.provider_job_ref,
            t2.language_probability,
            t2.reviewed_at,
            t2.reviewed_by
           FROM transcript t2
          WHERE t2.call_id = c.id AND t2.status = 'available'::text AND t2.archived_at IS NULL
         LIMIT 1) t ON true
     LEFT JOIN LATERAL ( SELECT r2.id,
            r2.org_id,
            r2.call_id,
            r2.provider,
            r2.provider_ref,
            r2.custody,
            r2.storage_path,
            r2.original_filename,
            r2.mime_type,
            r2.size_bytes,
            r2.duration_ms,
            r2.channels,
            r2.availability,
            r2.retention_expires_at,
            r2.signals_computed_at,
            r2.created_at,
            r2.created_by,
            r2.updated_at,
            r2.updated_by,
            r2.archived_at
           FROM recording r2
          WHERE r2.call_id = c.id AND r2.archived_at IS NULL
          ORDER BY r2.created_at
         LIMIT 1) rec ON true
     LEFT JOIN LATERAL ( SELECT j2.id,
            j2.org_id,
            j2.call_id,
            j2.recording_id,
            j2.provider,
            j2.provider_model,
            j2.status,
            j2.attempt,
            j2.error_message,
            j2.transcript_id,
            j2.requested_at,
            j2.started_at,
            j2.finished_at,
            j2.duration_ms,
            j2.created_by
           FROM transcription_job j2
          WHERE j2.call_id = c.id
          ORDER BY j2.requested_at DESC
         LIMIT 1) j ON true
     LEFT JOIN LATERAL ( SELECT e2.id,
            e2.org_id,
            e2.call_id,
            e2.rubric_version_id,
            e2.evaluator_id,
            e2.status,
            e2.supersedes_id,
            e2.yes_count,
            e2.no_count,
            e2.na_count,
            e2.applicable_count,
            e2.overall_score,
            e2.checklist_all_yes,
            e2.non_negotiables_all_pass,
            e2.author_end_state,
            e2.is_high_risk,
            e2.reward_tier,
            e2.summary_note,
            e2.created_at,
            e2.updated_at,
            e2.submitted_at,
            e2.archived_at,
            e2.kind,
            e2.derived_from_id,
            e2.escalation_note
           FROM evaluation e2
          WHERE e2.call_id = c.id AND e2.kind = 'raw_observation'::text AND e2.status = 'draft'::text
         LIMIT 1) e ON true
     LEFT JOIN person p ON p.id = e.evaluator_id
  WHERE c.archived_at IS NULL AND (c.workflow_status = ANY (ARRAY['draft'::text, 'ready_for_raw_qa'::text, 'raw_qa_in_progress'::text]));
