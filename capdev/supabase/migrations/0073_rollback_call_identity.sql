-- 0073 · Undo for a call-identity correction
--
-- Third migration of the 0071 package. DDL only: this migration corrects
-- nothing and reads no call data. It exists so that the Production correction
-- planned after 0071 has a way back.
--
-- WHAT THE 0071 PRODUCTION CORRECTION WILL ACTUALLY USE
--
-- Almost all of it already exists, from 0070, and is reused rather than
-- rebuilt:
--
--   v_call_identity_cleanup_preview   old title -> proposed title, eligibility
--                                     and the reason, per call. The operator
--                                     filters it by the approved ids.
--   cleanup_call_identity(uuid[])     the writer. Explicit ids only — there is
--                                     deliberately no form of it that selects
--                                     its own targets. Re-checks every
--                                     eligibility rule per call, skips on
--                                     equal, and snapshots to
--                                     call_identity_backup in the same
--                                     transaction as the write.
--   call_identity_backup              append-only. Its primary key is id and
--                                     its only other index is
--                                     (call_id, changed_at desc), so a second
--                                     snapshot for a call ADDS a row. The
--                                     pre-0070 snapshots cannot be overwritten
--                                     by the 0071 correction; both generations
--                                     sit in the same trail, in order.
--
-- Why cleanup_call_identity will not refuse these eight calls: it refuses a
-- title that is already app-generated, and it tests that by comparing the
-- title's third segment against compute_call_identity's date_text. Those eight
-- titles carry UTC dates and date_text is now Manila, so the segments differ,
-- the "already app-generated" branch does not fire, and the correction
-- proceeds. That is a real consequence of 0071 and it is verified in Sandbox
-- rather than assumed.
--
-- THE GAP THIS MIGRATION FILLS
--
-- There was no way back. call_identity_backup recorded what changed but
-- nothing read it, so undoing a correction meant hand-writing UPDATEs against
-- call.title in Production — exactly the kind of operation that should not be
-- improvised.
--
-- rollback_call_identity undoes the MOST RECENT recorded correction per call,
-- one step. To return a call to its pre-0070 state, undo each recorded
-- correction in turn, newest first, checking the preview between steps; there
-- is deliberately no single call that jumps to the oldest snapshot, because
-- that would silently discard the intervening history.
--
-- It refuses rather than guesses. If the call no longer carries the title the
-- correction wrote, something or someone has changed it since, and this
-- function will not overwrite that: it says so and moves on. This is the same
-- reasoning as the guard in derive_call_identity — never assume a title you
-- did not write is yours to replace.
--
-- Rollbacks are not written to call_identity_backup. That table is the trail
-- of forward corrections, and appending undos to it would make "the most
-- recent correction" ambiguous. The UPDATE is captured by the call_audit
-- trigger like any other change to call, so nothing goes unrecorded.

create or replace function public.rollback_call_identity(p_call_ids uuid[])
returns table (call_id uuid, outcome text, detail text)
language plpgsql
volatile
security invoker
set search_path to 'public'
as $function$
declare
  r_id uuid;
  c    record;
  b    record;
begin
  -- No ids, no work. There is deliberately no form of this function that
  -- selects its own targets.
  if p_call_ids is null or array_length(p_call_ids, 1) is null then
    return;
  end if;

  foreach r_id in array p_call_ids loop
    if r_id is null then
      continue;
    end if;

    select cc.id, cc.title, cc.author_name
      into c
      from public.call cc
     where cc.id = r_id and cc.archived_at is null;

    if not found then
      call_id := r_id; outcome := 'refused';
      detail := 'call not found, archived, or not visible to you';
      return next; continue;
    end if;

    -- The most recent recorded correction, and only that one.
    select bb.old_title, bb.old_author_name, bb.new_title, bb.new_author_name,
           bb.changed_at
      into b
      from public.call_identity_backup bb
     where bb.call_id = r_id
     order by bb.changed_at desc, bb.id desc
     limit 1;

    if not found then
      call_id := r_id; outcome := 'refused';
      detail := 'no recorded correction to undo';
      return next; continue;
    end if;

    -- Already back where the correction found it.
    if c.title = b.old_title
       and coalesce(c.author_name, '') = b.old_author_name then
      call_id := r_id; outcome := 'already_rolled_back';
      detail := 'call already carries the title recorded before that correction';
      return next; continue;
    end if;

    -- The call must still carry what the correction wrote. If it does not,
    -- something changed it afterwards and that change is not ours to discard.
    if c.title is distinct from b.new_title
       or coalesce(c.author_name, '') is distinct from b.new_author_name then
      call_id := r_id; outcome := 'refused';
      detail := format(
        'call has changed since that correction (expected %L, found %L); not undoing blindly',
        b.new_title, c.title);
      return next; continue;
    end if;

    update public.call
       set title = b.old_title,
           author_name = b.old_author_name
     where id = r_id;

    call_id := r_id; outcome := 'rolled_back';
    detail := format('restored %L (correction of %s)', b.old_title, b.changed_at);
    return next;
  end loop;
end;
$function$;

comment on function public.rollback_call_identity(uuid[]) is
  '0071/0073: undoes the most recent recorded call-identity correction, for explicitly named calls only. Refuses if the call no longer carries the title that correction wrote. Does not write to call_identity_backup; the call_audit trigger records the change. Operator-only: not granted to app-facing roles, and there is no bulk path.';

-- Postgres grants EXECUTE to PUBLIC by default and this project's Supabase
-- defaults also grant anon and authenticated. None of these belong to the app.
revoke all on function public.rollback_call_identity(uuid[]) from public;
revoke all on function public.rollback_call_identity(uuid[]) from anon;
revoke all on function public.rollback_call_identity(uuid[]) from authenticated;
