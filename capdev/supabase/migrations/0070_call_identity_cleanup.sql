-- 0070  Historical call-identity cleanup infrastructure.
--
-- 0069 derives a call's title from the Named Speakers at each submission
-- checkpoint, but deliberately refuses to overwrite a title this application
-- did not generate. That guard is what keeps "no backfill" true, and it means
-- the legacy free-text titles already in the database stay as they are.
--
-- This migration adds the tools to clean a chosen few of them ON PURPOSE. It
-- does NOT clean anything: installing it updates zero call rows. The only
-- mutation entry point takes an explicit array of call ids; there is no
-- set-based "clean everything" path anywhere in this file.
--
-- Shape:
--   compute_call_identity(uuid)        read-only. The one place the identity
--                                      rule lives. Answers what the identity
--                                      IS, never whether a call may be changed.
--   derive_call_identity(uuid)         0069's trigger writer, refactored to a
--                                      thin wrapper over the helper. Behaviour
--                                      unchanged, guard unchanged.
--   call_identity_conflict(uuid)       read-only. Returns a reason, or null.
--   call_identity_cleanup_exclusion    the recorded, human-entered conflicts.
--   call_identity_backup               the rollback record.
--   v_call_identity_cleanup_preview    eligibility, visible before anything runs.
--   cleanup_call_identity(uuid[])      the only writer. Explicit ids only.
--
-- Eligibility lives in the preview and the cleanup function, never in the
-- helper: a computed title is not permission to write it.

-- ---------------------------------------------------------------------------
-- The identity rule, in one read-only place.

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
  select
    coalesce(nullif(btrim(c.agent_name), ''), 'Rep not set')                        as rep_segment,
    a.authors                                                                        as authors,
    to_char(coalesce(c.occurred_at, c.created_at), 'DD Mon YYYY')                     as date_text,
    coalesce(nullif(btrim(c.agent_name), ''), 'Rep not set')
      || ' ' || chr(183) || ' ' || coalesce(a.authors, 'Author pending')
      || ' ' || chr(183) || ' ' || to_char(coalesce(c.occurred_at, c.created_at), 'DD Mon YYYY')
                                                                                     as proposed_title,
    coalesce(a.authors, '')                                                          as author_name,
    exists (select 1 from t)                                                         as has_transcript
  from c left join a on true;
$function$;

comment on function public.compute_call_identity(uuid) is
  '0070: the single read-only source of the call-identity rule. Returns what the identity is; says nothing about whether a call may be rewritten. Operator/trigger-internal: not granted to app-facing roles.';

-- ---------------------------------------------------------------------------
-- 0069's writer, now a thin wrapper. Behaviour is unchanged:
--   * missing/archived call, or no usable transcript -> no-op
--   * zero Authors -> author_name cleared, generated title returns to pending
--   * the title is written only when this application generated it

create or replace function public.derive_call_identity(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v          record;
  v_title    text;
  v_segments text[];
begin
  select * into v from public.compute_call_identity(p_call_id);
  if not found then
    return;                       -- call does not exist, or is archived
  end if;

  -- An absent transcript is an UNKNOWN state (pending, archived, superseded);
  -- clearing on it would destroy a good identity for no reason. A present
  -- transcript with nobody marked Author is somebody's answer, and falls
  -- through to the writes below with an empty author.
  if not v.has_transcript then
    return;
  end if;

  select c.title into v_title from public.call c where c.id = p_call_id;

  update public.call
     set author_name = v.author_name
   where id = p_call_id;

  -- A generated title has exactly three separated segments whose first is this
  -- call's representative segment and whose third is this call's date segment.
  -- Three segments alone would not be proof, so both anchors are checked. The
  -- middle segment is unconstrained: it is either the pending placeholder or a
  -- previously derived author string, and both must be refreshable.
  v_segments := string_to_array(coalesce(v_title, ''), ' ' || chr(183) || ' ');

  if coalesce(btrim(v_title), '') = ''
     or (array_length(v_segments, 1) = 3
         and v_segments[1] = v.rep_segment
         and v_segments[3] = v.date_text) then
    update public.call set title = v.proposed_title where id = p_call_id;
  end if;
end;
$function$;

comment on function public.derive_call_identity(uuid) is
  '0069/0070: writes call.author_name, and call.title when this app generated it, from the identity computed by compute_call_identity. Trigger-internal: not granted to app-facing roles.';

-- ---------------------------------------------------------------------------
-- Recorded identity conflicts.
--
-- A table, not a hard-coded id in a function body and not a rule buried in the
-- client: a conflict is evidence somebody recorded, and it has to be visible in
-- the preview and re-checked at write time.

create table if not exists public.call_identity_cleanup_exclusion (
  call_id     uuid primary key references public.call(id) on delete cascade,
  reason      text not null check (length(btrim(reason)) > 0),
  excluded_at timestamptz not null default now(),
  excluded_by uuid references public.person(id)
);

alter table public.call_identity_cleanup_exclusion enable row level security;

drop policy if exists cleanup_exclusion_read on public.call_identity_cleanup_exclusion;
create policy cleanup_exclusion_read on public.call_identity_cleanup_exclusion
  for select using (public.has_permission('call.read'));

comment on table public.call_identity_cleanup_exclusion is
  '0070: calls barred from historical identity cleanup, with the reason. Readable by anyone who can read calls; writable only by an owner/service-role session.';

-- ---------------------------------------------------------------------------
-- Conflict detection.
--
-- Two conditions are generic and derivable from the structured data:
--   C1  an Author name equal to the call''s own representative name
--   C2  an Author name that is a placeholder rather than a person
-- Both were tested against every live call in both environments and fire on
-- none of them, so they cost nothing today and catch a real class of bad data.
--
-- A third class is NOT generically detectable: a legacy title naming somebody
-- who differs slightly from the recorded Author (Takayla Nolen in the title,
-- Lakayla on the speaker). Nothing in the structured data disagrees with
-- itself there -- the only evidence is the old title, and fuzzy matching it
-- would need an extension and would still be a heuristic. Those go in the
-- exclusion table, by hand, with a reason.

create or replace function public.call_identity_conflict(p_call_id uuid)
returns text
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select coalesce(
    (select 'recorded conflict: ' || x.reason
       from public.call_identity_cleanup_exclusion x
      where x.call_id = p_call_id),
    (select 'an Author is named the same as the call''s representative ('
              || btrim(c.agent_name) || ')'
       from public.call c
       join public.transcript tr
         on tr.call_id = c.id and tr.archived_at is null and tr.status = 'available'
        and jsonb_typeof(tr.speakers) = 'object'
       cross join lateral jsonb_object_keys(tr.speakers) k
      where c.id = p_call_id
        and lower(btrim(coalesce((tr.speakers -> k) ->> 'role', ''))) = 'author'
        and lower(btrim(coalesce((tr.speakers -> k) ->> 'name', '')))
            = lower(btrim(coalesce(c.agent_name, '')))
        and coalesce(btrim(c.agent_name), '') <> ''
      limit 1),
    (select 'an Author name is a placeholder rather than a person ('
              || btrim((tr.speakers -> k) ->> 'name') || ')'
       from public.transcript tr
       cross join lateral jsonb_object_keys(tr.speakers) k
      where tr.call_id = p_call_id and tr.archived_at is null
        and tr.status = 'available' and jsonb_typeof(tr.speakers) = 'object'
        and lower(btrim(coalesce((tr.speakers -> k) ->> 'role', ''))) = 'author'
        and (lower(btrim(coalesce((tr.speakers -> k) ->> 'name', '')))
               = any (array['author','admin','unknown','n/a','na','guest','speaker',
                            'rep','representative','customer','client'])
             or lower(btrim(coalesce((tr.speakers -> k) ->> 'name', '')))
                ~ '^speaker[[:space:]]*[0-9]+$')
      limit 1)
  );
$function$;

comment on function public.call_identity_conflict(uuid) is
  '0070: returns a human-readable conflict reason barring historical cleanup, or null. Checks the recorded exclusions first, then two generic structural conditions.';

-- ---------------------------------------------------------------------------
-- The rollback record. Written before every cleanup write, never truncated.

create table if not exists public.call_identity_backup (
  id               uuid primary key default uuid_v7(),
  call_id          uuid not null references public.call(id) on delete cascade,
  old_title        text not null,
  old_author_name  text not null,
  new_title        text not null,
  new_author_name  text not null,
  changed_at       timestamptz not null default now(),
  changed_by       uuid references public.person(id)
);

create index if not exists call_identity_backup_call_idx
  on public.call_identity_backup (call_id, changed_at desc);

alter table public.call_identity_backup enable row level security;

drop policy if exists call_identity_backup_read on public.call_identity_backup;
create policy call_identity_backup_read on public.call_identity_backup
  for select using (public.has_permission('call.read'));

comment on table public.call_identity_backup is
  '0070: exact pre-cleanup title and author_name for every historical call identity rewritten. Restore joins on this. Never truncated by the cleanup function.';

-- ---------------------------------------------------------------------------
-- What cleanup WOULD do, visible before anything runs.
--
-- security_invoker so it can never become a way to read another organisation's
-- calls. In practice it is an operator view: it calls compute_call_identity,
-- which is not granted to app-facing roles.

drop view if exists public.v_call_identity_cleanup_preview;
create view public.v_call_identity_cleanup_preview
with (security_invoker = true) as
select
  c.id                                                   as call_id,
  c.title                                                as current_title,
  ci.rep_segment                                         as representative,
  coalesce(ci.authors, '(none)')                         as authors_found,
  ci.date_text                                           as date_used,
  ci.proposed_title                                      as proposed_title,
  (c.representative_id is not null
   and coalesce(btrim(c.agent_name), '') <> ''
   and ci.has_transcript
   and ci.authors is not null
   and exists (select 1 from public.evaluation e
                where e.call_id = c.id and e.status = 'submitted')
   and not (array_length(string_to_array(coalesce(c.title, ''),
                                         ' ' || chr(183) || ' '), 1) = 3
            and (string_to_array(c.title, ' ' || chr(183) || ' '))[1] = ci.rep_segment
            and (string_to_array(c.title, ' ' || chr(183) || ' '))[3] = ci.date_text)
   and public.call_identity_conflict(c.id) is null)      as eligible,
  case
    when c.representative_id is null then 'no linked representative'
    when coalesce(btrim(c.agent_name), '') = '' then 'representative name is blank'
    when not ci.has_transcript then 'no available transcript'
    when ci.authors is null then 'no speaker is explicitly marked Author'
    when not exists (select 1 from public.evaluation e
                      where e.call_id = c.id and e.status = 'submitted')
         then 'no submitted evaluation'
    when array_length(string_to_array(coalesce(c.title, ''),
                                      ' ' || chr(183) || ' '), 1) = 3
         and (string_to_array(c.title, ' ' || chr(183) || ' '))[1] = ci.rep_segment
         and (string_to_array(c.title, ' ' || chr(183) || ' '))[3] = ci.date_text
         then case when c.title = ci.proposed_title
                     and coalesce(c.author_name, '') = ci.author_name
                   then 'already clean'
                   else 'title is already app-generated; the submission triggers own it' end
    when public.call_identity_conflict(c.id) is not null
         then public.call_identity_conflict(c.id)
    else 'eligible'
  end                                                    as reason
from public.call c
cross join lateral public.compute_call_identity(c.id) ci
where c.archived_at is null;

comment on view public.v_call_identity_cleanup_preview is
  '0070: read-only preview of historical identity cleanup. Eligibility is decided here and re-checked in cleanup_call_identity; a computed title is never permission to write it.';

-- ---------------------------------------------------------------------------
-- The only writer.
--
-- security invoker, deliberately. This is an operator tool run in the SQL
-- editor, where the session already has the rights it needs; it must not be a
-- definer backdoor that rewrites titles for anyone who can reach it. Every
-- eligibility rule is re-checked here rather than inherited from the preview.

create or replace function public.cleanup_call_identity(p_call_ids uuid[])
returns table (call_id uuid, outcome text, detail text)
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  r_id       uuid;
  c          record;
  v          record;
  v_conflict text;
  v_person   uuid;
  v_segments text[];
begin
  -- No ids, no work. There is deliberately no form of this function that
  -- selects its own targets.
  if p_call_ids is null or array_length(p_call_ids, 1) is null then
    return;
  end if;

  select p.id into v_person
    from public.person p
   where p.auth_user_id = auth.uid() and p.archived_at is null
   limit 1;

  foreach r_id in array p_call_ids loop
    if r_id is null then
      continue;
    end if;

    select cc.id, cc.title, cc.author_name, cc.agent_name, cc.representative_id
      into c
      from public.call cc
     where cc.id = r_id and cc.archived_at is null;

    if not found then
      call_id := r_id; outcome := 'refused';
      detail := 'call not found, archived, or not visible to you';
      return next; continue;
    end if;

    select * into v from public.compute_call_identity(r_id);
    if not found then
      call_id := r_id; outcome := 'refused';
      detail := 'identity could not be computed';
      return next; continue;
    end if;

    -- Skip on equal: already carrying exactly what cleanup would write. No
    -- update, no updated_at bump, no second backup row.
    if c.title = v.proposed_title
       and coalesce(c.author_name, '') = v.author_name then
      call_id := r_id; outcome := 'already_clean';
      detail := 'title and author_name already match the computed identity';
      return next; continue;
    end if;

    if c.representative_id is null then
      call_id := r_id; outcome := 'refused'; detail := 'no linked representative';
      return next; continue;
    end if;

    if coalesce(btrim(c.agent_name), '') = '' then
      call_id := r_id; outcome := 'refused'; detail := 'representative name is blank';
      return next; continue;
    end if;

    if not v.has_transcript then
      call_id := r_id; outcome := 'refused'; detail := 'no available transcript';
      return next; continue;
    end if;

    if v.authors is null then
      call_id := r_id; outcome := 'refused';
      detail := 'no speaker is explicitly marked Author';
      return next; continue;
    end if;

    if not exists (select 1 from public.evaluation e
                    where e.call_id = r_id and e.status = 'submitted') then
      call_id := r_id; outcome := 'refused'; detail := 'no submitted evaluation';
      return next; continue;
    end if;

    v_segments := string_to_array(coalesce(c.title, ''), ' ' || chr(183) || ' ');
    if array_length(v_segments, 1) = 3
       and v_segments[1] = v.rep_segment
       and v_segments[3] = v.date_text then
      call_id := r_id; outcome := 'refused';
      detail := 'title is already app-generated; the submission triggers own it';
      return next; continue;
    end if;

    v_conflict := public.call_identity_conflict(r_id);
    if v_conflict is not null then
      call_id := r_id; outcome := 'refused'; detail := v_conflict;
      return next; continue;
    end if;

    -- Snapshot first, in the same transaction as the write.
    insert into public.call_identity_backup
      (call_id, old_title, old_author_name, new_title, new_author_name, changed_by)
    values
      (r_id, c.title, coalesce(c.author_name, ''), v.proposed_title, v.author_name, v_person);

    update public.call
       set title = v.proposed_title,
           author_name = v.author_name
     where id = r_id;

    call_id := r_id; outcome := 'cleaned'; detail := v.proposed_title;
    return next;
  end loop;
end;
$function$;

comment on function public.cleanup_call_identity(uuid[]) is
  '0070: rewrites the identity of explicitly named historical calls. Re-checks every eligibility rule, snapshots to call_identity_backup first, skips on equal. Operator-only: not granted to app-facing roles, and there is no bulk path.';

-- ---------------------------------------------------------------------------
-- Execute surface.
--
-- Postgres grants EXECUTE to PUBLIC by default and this project's Supabase
-- defaults also grant anon and authenticated. None of these belong to the app.

revoke all on function public.compute_call_identity(uuid)  from public;
revoke all on function public.compute_call_identity(uuid)  from anon;
revoke all on function public.compute_call_identity(uuid)  from authenticated;

revoke all on function public.call_identity_conflict(uuid) from public;
revoke all on function public.call_identity_conflict(uuid) from anon;
revoke all on function public.call_identity_conflict(uuid) from authenticated;

revoke all on function public.cleanup_call_identity(uuid[]) from public;
revoke all on function public.cleanup_call_identity(uuid[]) from anon;
revoke all on function public.cleanup_call_identity(uuid[]) from authenticated;

revoke all on function public.derive_call_identity(uuid)   from public;
revoke all on function public.derive_call_identity(uuid)   from anon;
revoke all on function public.derive_call_identity(uuid)   from authenticated;
