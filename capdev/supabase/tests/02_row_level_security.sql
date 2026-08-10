\pset pager off
\set ON_ERROR_STOP off

\echo '=== A. Signed OUT: every table returns zero rows ==='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select 'person' t, count(*) from public.person
union all select 'organization', count(*) from public.organization
union all select 'audit_event', count(*) from public.audit_event;
commit;

\echo '=== B. Signed IN: sees own org and people, but NOT audit ==='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select 'person visible' t, count(*) from public.person
union all select 'org visible', count(*) from public.organization
union all select 'audit visible (perm granted)', count(*) from public.audit_event
union all select 'my permissions', count(*) from public.v_my_permissions;
commit;

\echo '=== C. audit_event cannot be written through the API ==='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into public.audit_event (action, entity_type) values ('forged','person');
rollback;

\echo '=== D. Tenant isolation: outsider sees only their own org ==='
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select count(*) as people_visible, string_agg(display_name,', ') as who from public.person;
commit;
