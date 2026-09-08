-- 0071 · Canonical call date
--
-- One defect, in two halves that had to agree and did not.
--
-- A call title's third segment is a date. The client wrote it at upload from
-- the viewer's browser timezone; the database re-derived it on submission from
-- UTC. When those two disagreed — and for a Manila user they disagree for
-- eight hours of every day — the identity guard compared the stored segment
-- against its own UTC rendering, found them different, concluded the title had
-- been written by a human, and declined to touch it. The author was written to
-- call.author_name and the title stayed on "Author pending" forever.
--
-- The fix is to give the date one definition. Asia/Manila is the business
-- timezone: a call's date is a property of the call, not of whoever is looking
-- at it, and two people in different countries must read the same date. The
-- client half of this lives in formatCallDate() in capdev/web/src/lib/format.ts
-- and names the same zone.
--
-- What this migration deliberately does NOT do:
--   * It does not relax the guard. Exactly three segments, first equal to the
--     representative, third equal to the date, middle unconstrained, blank
--     titles writable, legacy titles protected. All unchanged.
--   * It does not touch derive_call_identity, call_identity_conflict or
--     cleanup_call_identity.
--   * It does not correct any existing row. Titles already generated under the
--     UTC rule keep a date that no longer matches the new rendering, which
--     means the guard will now decline to update them. Correcting those is a
--     separate, explicitly authorised step.
--
-- Idempotent: create or replace only, and no data is read or written.

create or replace function public.compute_call_identity(p_call_id uuid)
returns table (
  rep_segment    text,
  authors        text,
  date_text      text,
  proposed_title text,
  author_name    text,
  has_transcript boolean
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with c as (
    select id, agent_name, occurred_at, created_at
      from public.call
     where id = p_call_id and archived_at is null
  ),
  t as (
    -- A call can carry more than one available transcript, so the choice is
    -- ordered rather than arbitrary: reviewed outranks manual, which outranks
    -- the machine original; within a kind the newest version wins.
    select tr.speakers
      from public.transcript tr, c
     where tr.call_id = c.id
       and tr.archived_at is null
       and tr.status = 'available'
       and jsonb_typeof(tr.speakers) = 'object'
     order by case tr.kind when 'reviewed' then 0 when 'manual' then 1 else 2 end,
              tr.version_no desc
     limit 1
  ),
  a as (
    -- Authors by explicit role only. lower(btrim(role)) = 'author' is a
    -- canonical equality, never a prefix match, and a participant is never
    -- inferred from being "not the representative".
    --
    -- De-duplicated on lower(btrim(name)) because diarisation splits one person
    -- across several labels; distinct on ... order by <key>, k keeps the row
    -- belonging to the FIRST label, so the spelling shown is the one the
    -- reviewer typed first.
    select string_agg(d.display_name, ' & ' order by d.first_label) as authors
      from t
      cross join lateral (
        select distinct on (lower(btrim((t.speakers -> k) ->> 'name')))
               k as first_label,
               btrim((t.speakers -> k) ->> 'name') as display_name
          from jsonb_object_keys(t.speakers) k
         where lower(btrim(coalesce((t.speakers -> k) ->> 'role', ''))) = 'author'
           and nullif(btrim(coalesce((t.speakers -> k) ->> 'name', '')), '') is not null
         order by lower(btrim((t.speakers -> k) ->> 'name')), k
      ) d
  )
  -- The date is the call's business date, not the server's.
  --
  -- occurred_at and created_at are timestamptz and the database runs in UTC,
  -- so to_char() on the bare value rendered the UTC date. A call taken at
  -- 07 Sep 2026 16:34 UTC is 08 Sep 2026 in Manila, and that is the date the
  -- people on the call would give you. Reading it in UTC also made this
  -- disagree with the browser, which rendered the same instant in the viewer's
  -- own zone when it wrote the title at upload; where the two disagreed the
  -- date anchor stopped matching and the title was never filled in (0071).
  --
  -- Both renderings below are deliberately identical. If one is ever changed,
  -- change the other in the same edit: date_text is what the guard compares
  -- against, and proposed_title is what it writes.
  select
    coalesce(nullif(btrim(c.agent_name), ''), 'Rep not set')                        as rep_segment,
    a.authors                                                                        as authors,
    to_char(coalesce(c.occurred_at, c.created_at) at time zone 'Asia/Manila', 'DD Mon YYYY')
                                                                                     as date_text,
    coalesce(nullif(btrim(c.agent_name), ''), 'Rep not set')
      || ' ' || chr(183) || ' ' || coalesce(a.authors, 'Author pending')
      || ' ' || chr(183) || ' '
      || to_char(coalesce(c.occurred_at, c.created_at) at time zone 'Asia/Manila', 'DD Mon YYYY')
                                                                                     as proposed_title,
    coalesce(a.authors, '')                                                          as author_name,
    exists (select 1 from t)                                                         as has_transcript
  from c left join a on true;
$function$;

comment on function public.compute_call_identity(uuid) is
  '0070/0071: the single read-only source of the call-identity rule. Dates are rendered in the business timezone (Asia/Manila), matching formatCallDate() on the client. Returns what the identity is; says nothing about whether a call may be rewritten. Operator/trigger-internal: not granted to app-facing roles.';

-- create or replace preserves the existing ACL; these are restated so the
-- migration is safe to run against a database that never had 0070's revokes.
revoke all on function public.compute_call_identity(uuid) from public;
revoke all on function public.compute_call_identity(uuid) from anon;
revoke all on function public.compute_call_identity(uuid) from authenticated;
