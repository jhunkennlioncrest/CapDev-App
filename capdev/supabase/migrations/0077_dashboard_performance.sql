-- 0077_dashboard_performance.sql
--
-- Two read-only views behind the Dashboard's shared performance section.
-- Additive: no table, no column, no policy, no permission, and no change to
-- any existing view or function.
--
-- The visibility model this serves is deliberate. Performance analytics are
-- shared across every QA-facing role - Raw QA Reviewer included - because the
-- point is transparency, learning and calibration awareness. Seeing a number
-- grants no authority to change anything: both objects here are views, and
-- neither grants a permission.
--
-- The read boundary is the one that already exists. Every table these views
-- touch is protected by org isolation plus, where it matters, evaluation.read:
--
--   evaluation             org_id = current_org_id() AND has_permission('evaluation.read')
--   evaluation_score       the same, through its parent evaluation
--   person, call           org_id = current_org_id()
--
-- security_invoker = true on both, so the caller's own RLS decides what they
-- see. Neither view can become a way to read another organisation's data.


-- ---------------------------------------------------------------------------
-- 1. Raw QA performance per representative.
--
-- The Raw QA counterpart to v_rep_performance, which is calibrated-only. The
-- two are deliberately SEPARATE views rather than one view with a kind column:
-- Raw QA and QA Trainer are distinct scoring systems that happen to be
-- comparable, and a single view would be one refactor away from someone
-- averaging them.
--
-- The score is the same formula v_rep_performance uses -
-- 100 * sum(yes) / sum(applicable) - computed over UNDERLYING COUNTS, never by
-- averaging per-evaluation percentages. Two evaluations can have different
-- applicable denominators when criteria are N/A, and averaging their
-- percentages would silently weight a 4-criterion call the same as a
-- 15-criterion one. applicable_count already excludes N/A: it equals
-- yes_count + no_count on all 18 submitted evaluations in Sandbox.
--
-- overall_score is NOT used. Raw observations never populate it (0 of 10 in
-- Sandbox, against 10 of 10 for yes_count and applicable_count), so reading it
-- would produce a null score for every representative.
--
-- Deliberately absent: non_negotiables_clean, high_risk_calls, rewarded,
-- mean_of_evaluations. Those are Trainer concepts. Carrying them here would be
-- the first step toward the blended score this package exists to avoid.
--
-- THE HAVING CLAUSE IS LOAD-BEARING, and not for the reason it looks like.
--
-- It is mirrored from v_rep_performance, where it reads as old-rubric
-- housekeeping. It is not. The LEFT JOIN to call emits a row for every call a
-- representative has, including ones with no submitted observation; those rows
-- carry a null evaluation, so they group under a null rubric_version_id and
-- become a phantom "never observed" roster row ALONGSIDE the representative's
-- real one. Measured against Sandbox without this clause: 14 rows instead of
-- 10, with James Lewis, Joe Bays, Liza Parker and Monica Compton each
-- appearing twice. It fires with a single rubric version; it has nothing to do
-- with how many versions exist.
--
-- What it expresses: keep the version rows for anyone who has been observed,
-- and keep exactly one roster row for anyone who has not.

create or replace view public.v_rep_raw_observation_performance
with (security_invoker = true) as
select
    p.id                                                    as representative_id,
    p.org_id,
    p.display_name                                          as representative_name,
    p.department,
    p.employee_ref,
    p.status,
    p.archived_at is not null or p.status <> 'active'       as is_inactive,
    rv.id                                                   as rubric_version_id,
    rv.version_label,
    rv.status = 'active'                                    as is_current_rubric,
    count(e.id)                                             as observations,
    case
      when sum(e.applicable_count) > 0
      then round(100.0 * sum(e.yes_count)::numeric / sum(e.applicable_count)::numeric, 1)
    end                                                     as score,
    sum(e.applicable_count)                                 as criteria_assessed,
    sum(e.yes_count)                                        as criteria_met,
    min(e.submitted_at)                                     as first_observed,
    max(e.submitted_at)                                     as last_observed
  from public.person p
  left join public.call c
    on c.representative_id = p.id
   and c.archived_at is null
  left join public.evaluation e
    on e.call_id = c.id
   and e.kind = 'raw_observation'
   and e.status = 'submitted'
   and e.archived_at is null
  left join public.rubric_version rv
    on rv.id = e.rubric_version_id
 where p.is_representative
   and p.archived_at is null
 group by p.id, p.org_id, p.display_name, p.department, p.employee_ref,
          p.status, p.archived_at, rv.id, rv.version_label, rv.status
having rv.id is not null
    or count(e.id) = 0
   and not exists (
         select 1
           from public.call c2
           join public.evaluation e2 on e2.call_id = c2.id
          where c2.representative_id = p.id
            and c2.archived_at is null
            and e2.kind = 'raw_observation'
            and e2.status = 'submitted'
            and e2.archived_at is null);

comment on view public.v_rep_raw_observation_performance is
  '0077: Raw QA performance per representative, one row per rubric version, plus a single roster row for anyone never observed. The Raw QA counterpart to v_rep_performance, which is calibrated-only. Score is 100 * sum(yes_count) / sum(applicable_count) over submitted raw observations - underlying counts, never averaged percentages, and never overall_score, which Raw QA does not populate. Never averaged with Trainer performance: the two systems are compared side by side and nothing more.';


-- ---------------------------------------------------------------------------
-- 2. Calibration alignment, aggregated and anonymous.
--
-- Exists so the Dashboard can show one department-level Disagreements
-- percentage to every QA-facing role WITHOUT widening access to the
-- attributed, row-level comparison data.
--
-- v_calibration_comparison is deliberately UNCHANGED. It stays self-only for
-- anyone without calibration.perform, because what it exposes is a named
-- reviewer's disagreement on a named criterion of a named call, alongside the
-- trainer's written justification. That is performance-review material about a
-- specific person, and it is not what a department percentage needs.
--
-- This view carries counts and a rubric version. No reviewer_id, no
-- reviewer_name, no call, no criterion, no values, no justification. Nothing
-- here can be traced to a person.
--
-- Worth stating plainly: this grants no information that was not already
-- reachable. evaluation_score's read policy is org isolation plus
-- evaluation.read, which every role holds - so any signed-in member could
-- already total these columns by hand. The restriction on
-- v_calibration_comparison protects the ATTRIBUTED DETAIL, never the
-- aggregate. What this view adds is a shape that cannot be attributed, not an
-- access that did not exist.
--
-- "aligned" is not redefined here. v_calibration_comparison computes it as
-- s.variance = 'agreed'; this counts the complement of the same expression
-- against the same stored column, so the Dashboard and Calibration Accuracy
-- can never disagree about what a disagreement is. `is distinct from` rather
-- than `<>` so that a null variance counts as misaligned rather than vanishing
-- from both sides of the fraction.

create or replace view public.v_calibration_alignment_summary
with (security_invoker = true) as
select
    cal.org_id,
    cal.rubric_version_id,
    count(*)                                                     as comparisons,
    count(*) filter (where s.variance is distinct from 'agreed') as misaligned
  from public.evaluation cal
  join public.evaluation_score s
    on s.evaluation_id = cal.id
 where cal.kind = 'calibrated'
   and cal.status = 'submitted'
   and cal.archived_at is null
   and s.raw_value is not null
   and s.value is not null
 group by cal.org_id, cal.rubric_version_id;

comment on view public.v_calibration_alignment_summary is
  '0077: department-level calibration alignment, per rubric version. Counts only - no reviewer, call, criterion, value or justification, so nothing here is attributable to a person. Exists so the Dashboard can show a Disagreements percentage to every QA-facing role without widening v_calibration_comparison, which stays self-only and unchanged. A comparison is a submitted calibrated score carrying both a raw_value and a value; misaligned is the complement of that view''s own aligned test, variance = ''agreed''.';
