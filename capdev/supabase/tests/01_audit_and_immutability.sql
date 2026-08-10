\set ON_ERROR_STOP off
\pset pager off

-- seed
insert into public.organization (name, slug) values ('Atticus Press','atticus');
insert into public.person (org_id, email, display_name, status)
  select id, 'analyst@example.com', 'Test Analyst', 'active' from public.organization;

\echo '--- 1. INSERT writes an audit row automatically'
select action, entity_type, (diff->'after'->>'email') as captured
from public.audit_event where entity_type='person';

\echo '--- 2. UPDATE captures only the changed fields'
update public.person set display_name='Renamed Analyst' where email='analyst@example.com';
select action, diff->'before' as before, diff->'after' as after
from public.audit_event where action='person.updated';

\echo '--- 3. audit_event cannot be UPDATED (INV-03)'
update public.audit_event set action='tampered';

\echo '--- 4. audit_event cannot be DELETED (INV-03)'
delete from public.audit_event;

\echo '--- 5. duplicate active role grant is rejected'
insert into public.app_role (org_id, code, name)
  select id,'qa_analyst','QA Analyst' from public.organization;
insert into public.role_assignment (org_id, person_id, role_id)
  select o.id, p.id, r.id from public.organization o, public.person p, public.app_role r;
insert into public.role_assignment (org_id, person_id, role_id)
  select o.id, p.id, r.id from public.organization o, public.person p, public.app_role r;

\echo '--- 6. revoked grant does not block a new one'
update public.role_assignment set revoked_at=now();
insert into public.role_assignment (org_id, person_id, role_id)
  select o.id, p.id, r.id from public.organization o, public.person p, public.app_role r;
select count(*) as total_grants, count(*) filter (where revoked_at is null) as active
from public.role_assignment;

\echo '--- 7. audit trail is complete'
select action, count(*) from public.audit_event group by action order by action;
