-- 0069  Derive call identity from Named Speakers at submission.
--
-- The author is no longer asked for at upload: nobody has heard the call yet.
-- The call is stored with "Author pending" in the middle title segment, and the
-- database fills that segment in from the Named Speakers marked with the Author
-- role -- at Raw QA submission, and again at calibrated submission. After the
-- calibrated submission nothing fires again, so a completed record's identity
-- stops moving.
--
-- Two triggers rather than one, because a call reaches a submission by one of
-- two routes and only one of them produces a raw observation:
--   * Raw QA path      -> raw_observation submitted, then calibrated submitted
--   * direct Trainer   -> calibrated submitted only, no raw observation at all
-- Neither trigger reads qa_path, derived_from_id or workflow_status. qa_path is
-- not a reliable classifier (a Trainer can open a direct calibration on any call
-- from Call Detail without it ever being set), and workflow_status is advanced
-- by a monotonic guard that can decline to move.
--
-- Nothing existing is altered. No view is created, dropped or replaced.

-- ---------------------------------------------------------------------------
-- The derivation itself.
--
-- security definer because it writes call.title / call.author_name from inside
-- a submission made by Raw QA or a Trainer, and must not depend on either
-- holding call.upload. Scoped to one call id; it writes two display columns on
-- that call and nothing else.

create or replace function public.derive_call_identity(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_call      record;
  v_speakers  jsonb;
  v_authors   text;
  v_date      text;
  v_rep       text;
  v_title     text;
  v_segments  text[];
begin
  select id, title, agent_name, occurred_at, created_at
    into v_call
    from public.call
   where id = p_call_id and archived_at is null;

  -- Expected state, not an error: the call is gone or archived.
  if v_call is null then
    return;
  end if;

  -- The authoritative transcript. A call can carry more than one available
  -- transcript, so the choice is ordered rather than arbitrary: a reviewed
  -- transcript outranks a manual one, which outranks the machine original;
  -- within a kind, the newest version wins. This mirrors v_call_list.
  select t.speakers
    into v_speakers
    from public.transcript t
   where t.call_id = p_call_id
     and t.archived_at is null
     and t.status = 'available'
   order by case t.kind when 'reviewed' then 0 when 'manual' then 1 else 2 end,
            t.version_no desc
   limit 1;

  -- Expected states: no transcript yet, or one with no speakers named.
  if v_speakers is null or jsonb_typeof(v_speakers) <> 'object' then
    return;
  end if;

  -- Authors, by explicit role only.
  --
  -- lower(btrim(role)) = 'author' is a canonical equality, never a prefix
  -- match: "Author's spouse" is not an Author, and a participant is never
  -- inferred from being "not the representative".
  --
  -- De-duplicated on lower(btrim(name)) because diarisation splits one person
  -- across several labels and a reviewer names each of them. distinct on ...
  -- order by <key>, k keeps the row belonging to the FIRST label, so the
  -- spelling and casing shown are the ones the reviewer typed first --
  -- "Lakayla", not "lakayla".
  select string_agg(d.display_name, ' & ' order by d.first_label)
    into v_authors
    from (
      select distinct on (lower(btrim((v_speakers -> k) ->> 'name')))
             k as first_label,
             btrim((v_speakers -> k) ->> 'name') as display_name
        from jsonb_object_keys(v_speakers) k
       where lower(btrim(coalesce((v_speakers -> k) ->> 'role', ''))) = 'author'
         and nullif(btrim(coalesce((v_speakers -> k) ->> 'name', '')), '') is not null
       order by lower(btrim((v_speakers -> k) ->> 'name')), k
    ) d;

  -- Zero Authors is a KNOWN answer, not a missing one, and it must be able to
  -- clear an identity derived at an earlier checkpoint: Raw QA marks Marcus
  -- Stone, the Trainer decides he is not an author and changes the role, and
  -- the calibrated submission has to take his name back out. So there is no
  -- early return here -- the writes below fall through with an empty author
  -- and the pending placeholder.
  --
  -- This is deliberately NOT the same as the no-transcript case above. An
  -- absent transcript is an unknown state (pending, archived, superseded) and
  -- clearing on it would destroy a good identity for no reason. A present
  -- transcript with nobody marked Author is somebody's answer.
  --
  -- Submission is never blocked over any of this.

  v_rep  := coalesce(nullif(btrim(v_call.agent_name), ''), 'Rep not set');
  v_date := to_char(coalesce(v_call.occurred_at, v_call.created_at), 'DD Mon YYYY');

  -- author_name is a display cache and is always refreshed, including back to
  -- empty when nobody is marked Author any more.
  update public.call
     set author_name = coalesce(v_authors, '')
   where id = p_call_id;

  -- The title is only rewritten when this application generated it.
  --
  -- A generated title has exactly three ' - '-separated segments whose first
  -- segment is this call's representative segment and whose third is this
  -- call's date segment. Three segments alone would not be proof -- a legacy
  -- free-text title could coincidentally contain two separators -- so both
  -- anchors are checked. The middle segment is left unconstrained: it is
  -- either 'Author pending' or a previously derived author string, and both
  -- must be refreshable.
  v_segments := string_to_array(coalesce(v_call.title, ''), ' ' || chr(183) || ' ');

  if coalesce(btrim(v_call.title), '') = ''
     or (array_length(v_segments, 1) = 3
         and v_segments[1] = v_rep
         and v_segments[3] = v_date) then
    v_title := v_rep || ' ' || chr(183) || ' ' || coalesce(v_authors, 'Author pending')
                     || ' ' || chr(183) || ' ' || v_date;
    update public.call set title = v_title where id = p_call_id;
  end if;
end;
$function$;

comment on function public.derive_call_identity(uuid) is
  '0069: writes call.author_name, and call.title when this app generated it, from the Named Speakers marked Author on the authoritative transcript. Trigger-internal: not granted to app-facing roles.';

-- ---------------------------------------------------------------------------
-- The trigger wrapper.
--
-- Deriving a display title must never cost someone their submission, so an
-- unexpected failure here is non-blocking. It is NOT silent: it is recorded as
-- a failed audit_event and re-raised as a warning, so it shows up in the audit
-- trail and in the Postgres log rather than disappearing.
--
-- The expected states -- no transcript, no speakers, no Author -- are handled
-- inside derive_call_identity by returning early. They never reach this
-- handler, so a quiet audit trail means quiet, not suppressed.

create or replace function public.identity_on_evaluation_submit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_state  text;
  v_msg    text;
  v_astate text;
  v_amsg   text;
begin
  begin
    perform public.derive_call_identity(new.call_id);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;

    -- The warning goes out FIRST, so log visibility never depends on whether
    -- the audit insert below succeeds.
    raise warning
      'derive_call_identity failed for call % (evaluation %): % % -- the submission was not blocked and the title is unchanged',
      new.call_id, new.id, v_state, v_msg;

    -- The audit row is the durable record of the same fact, and it gets its own
    -- handler.
    --
    -- audit_event has RLS enabled with no INSERT policy; the insert works only
    -- because this function is owned by the table's owner and the table is not
    -- FORCE ROW LEVEL SECURITY. Every one of those conditions lives outside
    -- this migration. If any of them changes -- force RLS, an ownership change,
    -- a new BEFORE INSERT trigger -- an unguarded insert would raise from
    -- inside this handler and roll back the evaluation submission, which is the
    -- one thing this function promises never to do. So the promise is made
    -- structural rather than left resting on those conditions.
    begin
      insert into public.audit_event
        (org_id, actor_person_id, actor_type, action, entity_type, entity_id,
         diff, reason, result)
      values
        (new.org_id, null, 'system', 'call.identity_derive_failed', 'call',
         new.call_id,
         jsonb_build_object('sqlstate', v_state, 'message', v_msg,
                            'evaluation_id', new.id, 'evaluation_kind', new.kind),
         'Deriving the call title from Named Speakers failed. The submission was not blocked; the title is unchanged.',
         'failure');
    exception when others then
      get stacked diagnostics v_astate = returned_sqlstate, v_amsg = message_text;
      raise warning
        'audit_event insert ALSO failed while recording that derive failure (call %, evaluation %): % % -- the submission was still not blocked',
        new.call_id, new.id, v_astate, v_amsg;
    end;
  end;

  return new;
end;
$function$;

comment on function public.identity_on_evaluation_submit() is
  '0069: non-blocking wrapper. A derive failure raises a warning first, then attempts an audit_event row under its own handler, so neither the derive nor the audit logging can roll back an evaluation submission. Trigger-internal: not granted to app-facing roles.';

-- ---------------------------------------------------------------------------
-- The two submission checkpoints.

drop trigger if exists evaluation_derives_identity_raw on public.evaluation;
create trigger evaluation_derives_identity_raw
  after update on public.evaluation
  for each row
  when (new.kind = 'raw_observation'
        and new.status = 'submitted'
        and coalesce(old.status, '') <> 'submitted')
  execute function public.identity_on_evaluation_submit();

drop trigger if exists evaluation_derives_identity_calibrated on public.evaluation;
create trigger evaluation_derives_identity_calibrated
  after update on public.evaluation
  for each row
  when (new.kind = 'calibrated'
        and new.status = 'submitted'
        and coalesce(old.status, '') <> 'submitted')
  execute function public.identity_on_evaluation_submit();

-- ---------------------------------------------------------------------------
-- Execute surface.
--
-- Both functions are trigger-internal. Postgres grants EXECUTE to PUBLIC by
-- default, and this project's Supabase defaults also grant anon and
-- authenticated -- which would expose derive_call_identity as a PostgREST RPC:
-- a security definer function that rewrites call.title and call.author_name
-- outside RLS. It is not an app-facing endpoint, so those grants come off.
--
-- The trigger path is unaffected. identity_on_evaluation_submit is itself
-- security definer and owned by the same role, so it calls the helper as its
-- owner; and Postgres checks EXECUTE on a trigger function when the trigger is
-- created, not on every fire. Proven in Sandbox: as role authenticated a direct
-- call raises 42501 permission denied, while a submission through the trigger
-- still derives the title.
--
-- service_role keeps EXECUTE. It is a server-side secret, never held by a
-- browser session, and revoking it would break administrative repair.

revoke all on function public.derive_call_identity(uuid) from public;
revoke all on function public.derive_call_identity(uuid) from anon;
revoke all on function public.derive_call_identity(uuid) from authenticated;

revoke all on function public.identity_on_evaluation_submit() from public;
revoke all on function public.identity_on_evaluation_submit() from anon;
revoke all on function public.identity_on_evaluation_submit() from authenticated;
