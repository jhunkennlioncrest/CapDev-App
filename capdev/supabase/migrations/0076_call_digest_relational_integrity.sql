-- 0076_call_digest_relational_integrity.sql
--
-- Quick Listen — relational integrity for call_digest (0075 Phase 1, correction).
--
-- 0075 proved that each referenced row EXISTS. It did not prove they belong
-- together. Three holes were open:
--
--   1. call_digest.org_id could disagree with the org of call_digest.call_id
--   2. call_digest.transcript_id could belong to a different call
--   3. the transcript could belong to a different organisation
--
-- A row with any of those defects would still satisfy call_digest_read, because
-- that policy tests the digest's OWN org_id. So a digest carrying the reader's
-- org_id but another organisation's transcript would be readable by the wrong
-- people. RLS is not the place to catch this: the Phase 2 Edge Function writes
-- as service_role and bypasses RLS entirely, so a server-side bug is exactly
-- the thing that would produce such a row.
--
-- Enforced declaratively, with composite foreign keys. No trigger, no function.
--
-- No business row is read or written by this migration.
--
--
-- WHY THE UNIQUE CONSTRAINTS ARE FREE
--
-- A composite foreign key needs a unique index on the referenced columns, and
-- neither parent had one. Both constraints added below are supersets of an
-- existing PRIMARY KEY:
--
--   call (id, org_id)                  -- id is already the primary key
--   transcript (id, call_id, org_id)   -- id is already the primary key
--
-- A superset of a unique key is unique by construction. These therefore
-- constrain nothing that was not already constrained, cannot fail on any data
-- in any environment, now or on backfill, and change no existing behaviour.
-- What they cost is one extra index per parent table, maintained on insert.
--
--
-- WHY ON UPDATE IS LEFT AT NO ACTION
--
-- The new references pin call.org_id, transcript.call_id and transcript.org_id
-- while a digest points at them. That is only a restriction if something
-- actually updates those columns, and nothing does: across every migration and
-- every client write path, org_id and call_id are written on INSERT only.
-- Transcript supersession sets status, never call_id. Re-parenting a call or a
-- transcript is not an operation this system has, and if one is ever added it
-- should have to confront these constraints rather than slip past them.
--
--
-- CASCADE IS PRESERVED, DELIBERATELY
--
-- Both references keep ON DELETE CASCADE. 0075 established why: the shipped
-- delete_unsubmitted_call() deletes a call's children by hand and deletes
-- transcripts BEFORE the call, so a NO ACTION reference from call_digest breaks
-- Raw QA's delete-my-own-upload. Widening a reference must not quietly narrow
-- the delete behaviour, so the purge replay is re-run against this version.
--
--
-- REVERSAL (in concept — not run here)
--
--   alter table public.call_digest
--     drop constraint call_digest_transcript_id_call_id_org_id_fkey,
--     drop constraint call_digest_call_id_org_id_fkey;
--   alter table public.call_digest
--     add constraint call_digest_call_id_fkey
--       foreign key (call_id) references public.call(id) on delete cascade,
--     add constraint call_digest_transcript_id_fkey
--       foreign key (transcript_id) references public.transcript(id) on delete cascade;
--   alter table public.transcript drop constraint transcript_id_call_id_org_id_key;
--   alter table public.call       drop constraint call_id_org_id_key;


-- ---------------------------------------------------------------------------
-- Reference targets on the parent tables.
--
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so these are guarded the way
-- the rest of the schema guards re-runnable DDL.

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.call'::regclass and conname = 'call_id_org_id_key'
  ) then
    alter table public.call
      add constraint call_id_org_id_key unique (id, org_id);
  end if;
end $$;

comment on constraint call_id_org_id_key on public.call is
  '0076: reference target only. A superset of call_pkey, so it constrains nothing new; it exists so a child table can reference (id, org_id) as a pair and be unable to claim the wrong organisation for a call.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.transcript'::regclass
       and conname = 'transcript_id_call_id_org_id_key'
  ) then
    alter table public.transcript
      add constraint transcript_id_call_id_org_id_key unique (id, call_id, org_id);
  end if;
end $$;

comment on constraint transcript_id_call_id_org_id_key on public.transcript is
  '0076: reference target only. A superset of transcript_pkey, so it constrains nothing new; it exists so a child table can reference (id, call_id, org_id) as a triple and be unable to attach a transcript to the wrong call or the wrong organisation.';


-- ---------------------------------------------------------------------------
-- The digest's references, widened.
--
-- Replaced rather than supplemented: one constraint per relationship, so there
-- is never a question of which reference governs the cascade. call_digest holds
-- no rows outside a transaction anywhere, so nothing is revalidated.
--
-- call_digest_org_id_fkey is deliberately KEPT. It is now implied — org_id must
-- match a call, and a call's org_id already references organization — but it
-- costs nothing and states the intent for anyone reading the table alone.

alter table public.call_digest
  drop constraint if exists call_digest_call_id_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.call_digest'::regclass
       and conname = 'call_digest_call_id_org_id_fkey'
  ) then
    alter table public.call_digest
      add constraint call_digest_call_id_org_id_fkey
      foreign key (call_id, org_id)
        references public.call (id, org_id)
      on delete cascade;
  end if;
end $$;

comment on constraint call_digest_call_id_org_id_fkey on public.call_digest is
  '0076: the digest''s org_id must be the call''s own org_id, not merely some organisation. Blocks a service_role writer from minting a digest under the reader''s org that points at another org''s call.';

alter table public.call_digest
  drop constraint if exists call_digest_transcript_id_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.call_digest'::regclass
       and conname = 'call_digest_transcript_id_call_id_org_id_fkey'
  ) then
    alter table public.call_digest
      add constraint call_digest_transcript_id_call_id_org_id_fkey
      foreign key (transcript_id, call_id, org_id)
        references public.transcript (id, call_id, org_id)
      on delete cascade;
  end if;
end $$;

comment on constraint call_digest_transcript_id_call_id_org_id_fkey on public.call_digest is
  '0076: the transcript must belong to THIS call and THIS organisation. One triple rather than two pairs, because call_id and org_id are already pinned to the call by call_digest_call_id_org_id_fkey, so pinning the transcript to the same pair closes transcript-of-another-call and transcript-of-another-org together.';
