-- 0003 · Audit: append-only, immutable, never purged
--
-- INV-03. Created before any business table so no write can ever precede
-- audit capability.
--
-- This is also the mechanism that lets the browser talk directly to the
-- database without losing the audit guarantee: the trigger fires inside the
-- same transaction as the write, so an audit row cannot be skipped, forgotten,
-- or bypassed by a client, a service key, or a direct psql session.

create table public.audit_event (
  id               uuid primary key default public.uuid_v7(),
  org_id           uuid references public.organization(id),
  occurred_at      timestamptz not null default now(),
  actor_person_id  uuid references public.person(id),
  actor_type       text not null default 'user'
                   check (actor_type in ('user','system','ai','integration')),
  action           text not null check (length(trim(action)) > 0),
  entity_type      text not null check (length(trim(entity_type)) > 0),
  entity_id        uuid,
  entity_version   integer,
  diff             jsonb,
  reason           text,
  result           text not null default 'success' check (result in ('success','failure'))
);

create index audit_org_time_idx    on public.audit_event (org_id, occurred_at desc);
create index audit_entity_idx      on public.audit_event (entity_type, entity_id, occurred_at desc);
create index audit_actor_idx       on public.audit_event (actor_person_id, occurred_at desc);

-- Append-only at the database layer, not by convention.
create trigger audit_event_immutable
  before update or delete on public.audit_event
  for each row execute function public.reject_mutation();

-- Resolves the signed-in auth user to their domain identity.
create or replace function public.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.person
  where auth_user_id = auth.uid() and archived_at is null
  limit 1;
$$;

-- Generic audit trigger. Attached per table; records the acting person, the
-- entity, and a before/after diff of changed columns only.
create or replace function public.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor    uuid;
  act      text;
  payload  jsonb;
  target   uuid;
  org      uuid;
begin
  begin
    actor := public.current_person_id();
  exception when others then
    actor := null;                      -- system context, no signed-in user
  end;

  if tg_op = 'INSERT' then
    act := tg_table_name || '.created';
    payload := jsonb_build_object('after', to_jsonb(new));
    target := new.id;
  elsif tg_op = 'UPDATE' then
    act := tg_table_name || '.updated';
    payload := jsonb_build_object(
      'before', (select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(old))
                 where to_jsonb(new) -> key is distinct from value),
      'after',  (select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(new))
                 where to_jsonb(old) -> key is distinct from value));
    target := new.id;
  else
    act := tg_table_name || '.deleted';
    payload := jsonb_build_object('before', to_jsonb(old));
    target := old.id;
  end if;

  org := coalesce(
    (to_jsonb(coalesce(new, old)) ->> 'org_id')::uuid,
    (to_jsonb(coalesce(new, old)) ->> 'id')::uuid);

  insert into public.audit_event
    (org_id, actor_person_id, actor_type, action, entity_type, entity_id, diff)
  values
    (org, actor, case when actor is null then 'system' else 'user' end,
     act, tg_table_name, target, payload);

  return coalesce(new, old);
end;
$$;

create trigger person_audit
  after insert or update or delete on public.person
  for each row execute function public.write_audit();

create trigger role_assignment_audit
  after insert or update or delete on public.role_assignment
  for each row execute function public.write_audit();
