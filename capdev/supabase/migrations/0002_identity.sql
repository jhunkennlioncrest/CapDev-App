-- 0002 · Identity: organization, person, roles
--
-- Identity boundary (Domain Blueprint §6.2): auth.users is an AUTHENTICATION
-- record. person is the DOMAIN identity and is authoritative. They are linked,
-- never conflated — deleting an auth record must not orphan evaluation history.
--
-- INV-30: every tenant-scoped row carries org_id from the first migration.
-- Retrofitting tenancy onto a populated schema is among the most expensive
-- migrations that exist, so it goes in while there is one tenant.

create table public.organization (
  id          uuid primary key default public.uuid_v7(),
  name        text not null check (length(trim(name)) > 0),
  slug        citext not null unique,
  status      text not null default 'active'
              check (status in ('provisioned','active','suspended','archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.person (
  id                uuid primary key default public.uuid_v7(),
  org_id            uuid not null references public.organization(id),
  auth_user_id      uuid unique,                    -- FK to auth.users in Supabase
  email             citext not null,
  display_name      text not null default '',
  status            text not null default 'invited'
                    check (status in ('invited','active','suspended','offboarded','archived')),
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.person(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.person(id),
  archived_at       timestamptz,
  unique (org_id, email)
);

comment on column public.person.auth_user_id is
  'Link to the Supabase auth record. Nullable so a person can be invited before first sign-in.';
comment on column public.person.version is
  'Optimistic concurrency (INV-29). Stale writes are rejected, never silently merged.';

create index person_org_active_idx on public.person (org_id)
  where archived_at is null;

create trigger person_set_updated_at
  before update on public.person
  for each row execute function public.set_updated_at();

-- Roles as scoped assignments, never a column on person (Domain Blueprint §A):
-- one human is a Coach in one unit and an Agent in another, simultaneously.
create table public.permission (
  code        text primary key,
  description text not null
);

create table public.app_role (
  id          uuid primary key default public.uuid_v7(),
  org_id      uuid not null references public.organization(id),
  code        text not null,
  name        text not null,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (org_id, code)
);

create table public.role_permission (
  role_id         uuid not null references public.app_role(id) on delete cascade,
  permission_code text not null references public.permission(code),
  primary key (role_id, permission_code)
);

create table public.role_assignment (
  id           uuid primary key default public.uuid_v7(),
  org_id       uuid not null references public.organization(id),
  person_id    uuid not null references public.person(id),
  role_id      uuid not null references public.app_role(id),
  granted_at   timestamptz not null default now(),
  granted_by   uuid references public.person(id),
  revoked_at   timestamptz,
  revoked_by   uuid references public.person(id),
  reason       text,
  check (revoked_at is null or revoked_at >= granted_at)
);

-- One active grant per person per role. Revoked grants are retained.
create unique index role_assignment_active_uniq
  on public.role_assignment (person_id, role_id)
  where revoked_at is null;

create index role_assignment_person_active_idx
  on public.role_assignment (person_id)
  where revoked_at is null;
