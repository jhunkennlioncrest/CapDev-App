-- 0066_delete_unsubmitted_call.sql
--
-- Raw QA may permanently purge a call they uploaded themselves, until they
-- submit it. Once submitted, the call is protected.
--
-- INV-11 — Submitted QA records are retained. Raw QA may permanently purge
-- their own uploaded call records at any point before submission. Once a call
-- has been submitted, it is protected from deletion.
--
-- This is a genuine purge, not an archive. The storage object is removed by
-- the client (SQL cannot reach the bucket); these functions remove the rows.
--
-- Creates two functions and nothing else. No table, column, view, policy or
-- trigger is created or altered.


-- Runs every guard and returns the storage paths to delete. Deletes nothing.
-- The client calls this first, removes the objects, then calls the delete.
create or replace function public.authorize_call_purge(p_call_id uuid)
returns table (storage_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call public.call%rowtype;
begin
  select * into v_call from public.call where id = p_call_id;

  -- Same message for "not there" and "not yours", so a caller in another
  -- organisation cannot tell the difference. security definer disables RLS
  -- inside this function, so the org check is made by hand.
  if not found or v_call.org_id <> public.current_org_id() then
    raise exception 'That call does not exist.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.v_my_permissions
     where permission_code = 'raw_qa.submit'
  ) then
    raise exception 'You are not authorised to delete calls.' using errcode = 'P0001';
  end if;

  if v_call.created_by is null
     or v_call.created_by <> public.current_person_id() then
    raise exception 'You can only delete a call you uploaded yourself.'
      using errcode = 'P0001';
  end if;

  -- submitted_at, deliberately, not status. Calibration supersedes a submitted
  -- raw observation, and a status test would then read a call Raw QA really did
  -- submit as never submitted. submitted_at is written once and never cleared.
  if exists (
    select 1 from public.evaluation e
     where e.call_id = p_call_id
       and e.kind = 'raw_observation'
       and e.submitted_at is not null
  ) then
    raise exception 'This call has been submitted and can no longer be deleted.'
      using errcode = 'P0001';
  end if;

  -- Required by the schema, not by policy. guard_submitted_evidence() fires
  -- BEFORE DELETE and raises for evidence whose subject is a score on a
  -- submitted evaluation. The delete would throw regardless; refusing here
  -- turns an obscure trigger failure into a readable message. It does not
  -- change which calls are deletable.
  if exists (
    select 1
      from public.evidence ev
      join public.evaluation_score s on s.id = ev.subject_id
      join public.evaluation e       on e.id = s.evaluation_id
     where ev.call_id = p_call_id
       and ev.subject_type = 'evaluation_score'
       and e.status = 'submitted'
  ) then
    raise exception
      'This call carries evidence on a submitted evaluation and cannot be deleted.'
      using errcode = 'P0001';
  end if;

  return query
    select r.storage_path
      from public.recording r
     where r.call_id = p_call_id
       and r.storage_path is not null;
end;
$$;


-- Removes the call and everything that hangs off it.
create or replace function public.delete_unsubmitted_call(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Re-runs every guard. The client is not a security boundary, and nothing
  -- guarantees authorize_call_purge() was called first.
  perform public.authorize_call_purge(p_call_id);

  -- NO ACTION references to evaluation. Neither table carries call_id, so both
  -- are keyed on the call's evaluation ids, and both must precede evaluation.
  delete from public.case_study_source
   where evaluation_id in (select id from public.evaluation where call_id = p_call_id);

  delete from public.calibration_assignment
   where raw_evaluation_id in
           (select id from public.evaluation where call_id = p_call_id)
      or calibrated_evaluation_id in
           (select id from public.evaluation where call_id = p_call_id);

  -- Children before parents: every foreign key to call is NO ACTION.
  --
  -- One statement per table, which also satisfies the NO ACTION self
  -- references on transcript.supersedes_id and evaluation.derived_from_id /
  -- supersedes_id, because those are checked at statement end.
  --
  -- Deleted implicitly, invisible in this list: evaluation_score and
  -- evaluation_stage_score CASCADE from evaluation; case_study_evidence and
  -- case_study_moment CASCADE from evidence and moment; risk_record.
  -- evaluation_id is SET NULL, then risk_record CASCADEs from call.
  delete from public.evidence          where call_id = p_call_id;
  delete from public.moment            where call_id = p_call_id;
  delete from public.evaluation        where call_id = p_call_id;
  delete from public.playlist_call     where call_id = p_call_id;
  delete from public.transcription_job where call_id = p_call_id;
  delete from public.transcript        where call_id = p_call_id;
  delete from public.recording         where call_id = p_call_id;
  delete from public.call              where id      = p_call_id;
end;
$$;


revoke all on function public.authorize_call_purge(uuid)    from public;
revoke all on function public.delete_unsubmitted_call(uuid) from public;
grant execute on function public.authorize_call_purge(uuid)    to authenticated;
grant execute on function public.delete_unsubmitted_call(uuid) to authenticated;
