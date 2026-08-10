-- 0005 · Seed: organization, permission vocabulary, roles, first administrator
--
-- Idempotent. Safe to re-run.
-- Set the first administrator email before running:  \set admin_email 'you@company.com'

insert into public.permission (code, description) values
  ('person.read',        'View people in the organization'),
  ('person.manage',      'Create and update people'),
  ('role.grant',         'Grant and revoke roles'),
  ('call.upload',        'Upload call recordings'),
  ('call.read',          'View calls and recordings'),
  ('evaluation.create',  'Start an evaluation'),
  ('evaluation.submit',  'Submit an evaluation'),
  ('evaluation.read',    'View evaluations'),
  ('moment.create',      'Clip moments'),
  ('moment.read',        'View moments'),
  ('knowledge.author',   'Write knowledge articles'),
  ('knowledge.publish',  'Publish knowledge to Notion'),
  ('audit.read',         'Read the audit trail')
on conflict (code) do nothing;

insert into public.organization (name, slug)
values ('Atticus Press', 'atticus')
on conflict (slug) do nothing;

insert into public.app_role (org_id, code, name, is_system)
select o.id, r.code, r.name, true
from public.organization o,
     (values ('administrator','Administrator'),
             ('qa_lead','QA Lead'),
             ('qa_analyst','QA Analyst'),
             ('auditor','Auditor')) as r(code, name)
where o.slug = 'atticus'
on conflict (org_id, code) do nothing;

-- Administrator: everything except audit.read.
-- Deliberate: an administrator investigating their own actions is not a control.
insert into public.role_permission (role_id, permission_code)
select r.id, p.code from public.app_role r, public.permission p
where r.code = 'administrator' and p.code <> 'audit.read'
on conflict do nothing;

insert into public.role_permission (role_id, permission_code)
select r.id, p.code from public.app_role r, public.permission p
where r.code = 'qa_lead'
  and p.code in ('person.read','call.upload','call.read','evaluation.create',
                 'evaluation.submit','evaluation.read','moment.create','moment.read',
                 'knowledge.author','knowledge.publish')
on conflict do nothing;

insert into public.role_permission (role_id, permission_code)
select r.id, p.code from public.app_role r, public.permission p
where r.code = 'qa_analyst'
  and p.code in ('person.read','call.upload','call.read','evaluation.create',
                 'evaluation.submit','evaluation.read','moment.create','moment.read')
on conflict do nothing;

-- Auditor: read-only everywhere, including audit. No write permission at all.
insert into public.role_permission (role_id, permission_code)
select r.id, p.code from public.app_role r, public.permission p
where r.code = 'auditor'
  and (p.code like '%.read' or p.code = 'audit.read')
on conflict do nothing;
