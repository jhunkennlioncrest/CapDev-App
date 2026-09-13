-- 0074 · Completed-quality risk visibility
--
-- A risk record was readable by exactly two audiences: a QA Trainer, and the
-- person who raised it. Everyone else saw nothing — including every role that
-- can open the completed quality record the risk belongs to. So a manager or a
-- reviewer could read a finished evaluation and never learn that the call had
-- been escalated, which is the opposite of what a permanent record is for.
--
-- WHAT THIS DOES NOT DO
--
-- It does not touch risk_record_read. That policy still grants a trainer, and
-- still grants the raiser, exactly as before. Postgres ORs permissive SELECT
-- policies, so this one only ever adds; it can take nothing away. Organisation
-- isolation is repeated here rather than assumed, so the new path cannot become
-- the way a row escapes its org.
--
-- It grants no INSERT, UPDATE or DELETE. Determining a risk, resolving one and
-- setting its status remain exactly where they were.
--
-- WHY THE GATE IS THE CALL, NOT THE CALL'S RISK
--
-- The audience being matched is "people who can read the completed quality
-- record". That record exists once the call carries a non-archived, submitted
-- CALIBRATED evaluation — the same condition that puts it in
-- v_quality_repository. So that, and not merely "a call exists", is the gate.
-- Risks on calls still in Raw QA or mid-calibration stay restricted to the
-- trainer and the raiser: work in progress is not a published record.
--
-- Deliberately NOT gated on the risk being determined. An outstanding
-- "Awaiting determination" risk is precisely the thing a completed quality
-- record must not hide; filtering those out would make a finished record look
-- settled when it is not.
--
-- WHY archived_at IS NULL
--
-- sync_risk_from_flag archives a risk_record when an evaluation's is_high_risk
-- is cleared. An un-flagged risk has been retracted, not resolved, and is not
-- history to publish to a wider audience. v_risk_register already filters it,
-- but a table's own policy should not depend on a view doing so.
--
-- evaluation.read is held by every role in this schema today, so in practice
-- this exposes completed-call risks to everyone who can sign in. That is the
-- decision: the audience for the risk record is the audience for the record it
-- belongs to. Narrowing it later means narrowing evaluation.read or
-- introducing a dedicated permission, not editing this policy in isolation.

create policy risk_record_read_completed_quality
on public.risk_record
for select
using (
  org_id = current_org_id()
  and archived_at is null
  and has_permission('evaluation.read')
  and exists (
    select 1
      from public.evaluation e
     where e.call_id = risk_record.call_id
       and e.kind = 'calibrated'
       and e.status = 'submitted'
       and e.archived_at is null
  )
);

comment on policy risk_record_read_completed_quality on public.risk_record is
  '0074: read access for the completed-quality audience. Additive — risk_record_read still grants the trainer and the raiser. Only non-archived risks, only on calls carrying a non-archived submitted calibrated evaluation, only for readers holding evaluation.read, only within their own organisation.';
