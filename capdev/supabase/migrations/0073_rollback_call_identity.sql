-- 0073 · Undo for a call-identity correction
--
-- Third migration of the 0071 package. DDL only: this migration corrects
-- nothing and reads no call data.
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
-- Why cleanup_call_identity will not refuse the eight Production calls: it
-- refuses a title that is already app-generated, and it tests that by comparing
-- the title's third segment against compute_call_identity's date_text. Those
-- eight titles carry UTC dates and date_text is now Manila, so the segments
-- differ, the "already app-generated" branch does not fire, and the correction
-- proceeds. That is a real consequence of 0071 and it is verified in Sandbox
-- rather than assumed.
--
-- THE GAP THIS MIGRATION FILLS
--
-- There was no way back. call_identity_backup recorded what changed but nothing
-- read it, so undoing a correction meant hand-writing UPDATEs against
-- call.title in Production — exactly the kind of operation that should not be
-- improvised.
--
-- HOW THE WALK WORKS, AND WHY IT IS ANCHORED ON THE CURRENT STATE
--
-- The function undoes ONE correction per call per call, and it finds which one
-- by asking a single question: which recorded correction produced the state
-- this call is standing on right now? That is the newest backup row whose
-- new_title and new_author_name equal the call's current title and author.
-- Restoring that row's old_title and old_author_name steps back exactly one
-- correction, and leaves the call standing on the OUTPUT of the correction
-- before it — so calling again steps back again, and a stacked history is
-- walked to its beginning one call at a time.
--
--   backup 1: A -> B
--   backup 2: B -> C
--   call is C   -> matches backup 2's output   -> restore B
--   call is B   -> matches backup 1's output   -> restore A
--   call is A   -> matches no output           -> nothing left to undo
--
-- Anchoring on the newest row REGARDLESS of the current state does not work,
-- and the first version of this function made exactly that mistake. With the
-- history above and the call sitting at B, it selected backup 2 again, found
-- that B already equalled backup 2's old_title, reported already_rolled_back,
-- and never reached backup 1. A two-generation history could be walked back
-- one step and no further — and two generations is precisely what Production
-- will have, since 0070 wrote the first and the 0071 correction writes the
-- second. The documented ability to reach the pre-0070 state was false.
--
-- Author name participates in the match, not only the title. Two corrections
-- can leave the same title and differ only in the author, and matching on the
-- title alone would pick the wrong generation.
--
-- A recorded row whose old and new values are identical is ignored as a
-- candidate. cleanup_call_identity skips on equal so it never writes one, but
-- if such a row existed, "restoring" it would change nothing and the walk would
-- stand still on it forever.
--
-- It refuses rather than guesses. If the current state matches no recorded
-- correction's output, the function will not write. It distinguishes two
-- reasons, because they mean different things to an operator:
--
--   the state matches a recorded correction's INPUT  -> already walked back
--                                                       past it, nothing to do
--   the state matches neither input nor output       -> something changed the
--                                                       call outside the trail,
--                                                       and that change is not
--                                                       ours to discard
--
-- Rollbacks are not written to call_identity_backup. That table is the trail of
-- forward corrections, and appending undos to it would corrupt the walk: an undo
-- row's output is the previous correction's input, and the two would chase each
-- other. The UPDATE is captured by the call_audit trigger like any other change
-- to call, so nothing goes unrecorded.

create or replace function public.rollback_call_identity(p_call_ids uuid[])
returns table (call_id uuid, outcome text, detail text)
language plpgsql
volatile
security invoker
set search_path to 'public'
as $function$
declare
  r_id       uuid;
  c          record;
  b          record;
  v_author   text;
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

    select cc.id, cc.title, coalesce(cc.author_name, '') as author_name
      into c
      from public.call cc
     where cc.id = r_id and cc.archived_at is null;

    if not found then
      call_id := r_id; outcome := 'refused';
      detail := 'call not found, archived, or not visible to you';
      return next; continue;
    end if;

    v_author := c.author_name;

    -- The newest recorded correction whose OUTPUT is the state the call is
    -- standing on. That is the one correction there is to undo from here.
    select bb.old_title, bb.old_author_name, bb.new_title, bb.new_author_name,
           bb.changed_at
      into b
      from public.call_identity_backup bb
     where bb.call_id = r_id
       and bb.new_title = c.title
       and bb.new_author_name = v_author
       -- A row that changed nothing carries no information, and restoring it
       -- would leave the walk standing still on it.
       and not (bb.new_title = bb.old_title
                and bb.new_author_name = bb.old_author_name)
     order by bb.changed_at desc, bb.id desc
     limit 1;

    if not found then
      -- Nothing produced this state. Say which of the two reasons it is.
      if not exists (select 1 from public.call_identity_backup bb
                      where bb.call_id = r_id) then
        call_id := r_id; outcome := 'refused';
        detail := 'no recorded correction to undo';
        return next; continue;
      end if;

      if exists (select 1 from public.call_identity_backup bb
                  where bb.call_id = r_id
                    and bb.old_title = c.title
                    and bb.old_author_name = v_author) then
        call_id := r_id; outcome := 'already_rolled_back';
        detail := 'call is at a state recorded as the input to a correction; '
               || 'there is no later correction left to undo';
        return next; continue;
      end if;

      call_id := r_id; outcome := 'refused';
      detail := format(
        'current title %L / author %L matches no recorded correction, in either '
        || 'direction; the call was changed outside the correction trail and '
        || 'that change is not ours to discard',
        c.title, v_author);
      return next; continue;
    end if;

    update public.call
       set title = b.old_title,
           author_name = b.old_author_name
     where id = r_id;

    call_id := r_id; outcome := 'rolled_back';
    detail := format('restored %L (undid the correction of %s, which had written %L)',
                     b.old_title, b.changed_at, b.new_title);
    return next;
  end loop;
end;
$function$;

comment on function public.rollback_call_identity(uuid[]) is
  '0071/0073: undoes one call-identity correction per call, for explicitly named calls only. Finds the correction to undo by matching the call''s CURRENT title and author against recorded correction outputs, so repeated calls walk a stacked history back one generation at a time. Refuses when the current state matches no recorded correction. Does not write to call_identity_backup; the call_audit trigger records the change. Operator-only: not granted to app-facing roles, and there is no bulk path.';

-- Postgres grants EXECUTE to PUBLIC by default and this project's Supabase
-- defaults also grant anon and authenticated. None of these belong to the app.
revoke all on function public.rollback_call_identity(uuid[]) from public;
revoke all on function public.rollback_call_identity(uuid[]) from anon;
revoke all on function public.rollback_call_identity(uuid[]) from authenticated;
