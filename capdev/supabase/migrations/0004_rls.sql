-- 0004 · Row-level security and the permission view
--
-- With the browser talking directly to the database, RLS is not a backstop —
-- it IS the access control. Every table is default-deny; a policy must exist
-- for a row to be readable.
--
-- Business RULES (immutability, audit) are enforced by triggers, because a
-- policy can say who may write but not whether a rule was followed.

alter table public.organization    enable row level security;
alter table public.person          enable row level security;
alter table public.app_role        enable row level security;
alter table public.permission      enable row level security;
alter table public.role_permission enable row level security;
alter table public.role_assignment enable row level security;
alter table public.audit_event     enable row level security;

-- Org of the signed-in person. security definer so it can read past RLS.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.person
  where auth_user_id = auth.uid() and archived_at is null
  limit 1;
$$;

create or replace function public.has_permission(code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.role_assignment ra
    join public.role_permission rp on rp.role_id = ra.role_id
    join public.person p on p.id = ra.person_id
    where p.auth_user_id = auth.uid()
      and ra.revoked_at is null
      and p.archived_at is null
      and rp.permission_code = code
  );
$$;

-- Everyone signed in reads their own organization and its people.
create policy org_read on public.organization
  for select using (id = public.current_org_id());

create policy person_read on public.person
  for select using (org_id = public.current_org_id());

create policy person_update_self on public.person
  for update using (auth_user_id = auth.uid())
  with check  (auth_user_id = auth.uid());

create policy role_read on public.app_role
  for select using (org_id = public.current_org_id());

create policy permission_read on public.permission
  for select using (auth.uid() is not null);

create policy role_permission_read on public.role_permission
  for select using (auth.uid() is not null);

create policy role_assignment_read on public.role_assignment
  for select using (org_id = public.current_org_id());

-- Audit is readable only with the explicit permission, and never writable
-- through the API: rows arrive via SECURITY DEFINER triggers.
create policy audit_read on public.audit_event
  for select using (public.has_permission('audit.read'));

-- Permissions of the signed-in person, for the UI to gate controls.
create view public.v_my_permissions
with (security_invoker = true) as
  select distinct rp.permission_code
  from public.role_assignment ra
  join public.role_permission rp on rp.role_id = ra.role_id
  join public.person p on p.id = ra.person_id
  where p.auth_user_id = auth.uid()
    and ra.revoked_at is null
    and p.archived_at is null;

-- New Google sign-in -> link to an invited person, or leave unlinked so the
-- app can say "you are not invited" rather than showing a blank screen.
create or replace function public.link_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.person
     set auth_user_id = new.id,
         status       = case when status = 'invited' then 'active' else status end,
         display_name = case
                          when display_name = ''
                          then coalesce(new.raw_user_meta_data ->> 'full_name', '')
                          else display_name
                        end
   where email = new.email
     and auth_user_id is null
     and archived_at is null;
  return new;
end;
$$;
