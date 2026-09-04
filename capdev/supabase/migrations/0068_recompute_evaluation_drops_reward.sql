-- 0068_recompute_evaluation_drops_reward.sql
--
-- The Trainer-derived path is authoritative for rewards:
--   evaluation_stage_score -> v_trainer_score -> v_trainer_determination
--                          -> v_trainer_reward
--
-- recompute_evaluation() STAYS. It is the sole maintainer of yes_count,
-- no_count, na_count, applicable_count, overall_score, checklist_all_yes and
-- non_negotiables_all_pass, which v_rep_performance and v_trainer_determination
-- both depend on. Only its reward responsibility is removed.
--
-- Removed, exhaustively, against the previous definition:
--   1. the `tier text` declaration
--   2. the tier := 'none' / premium / kudos block
--   3. `reward_tier = tier` from the calibrated UPDATE
--   4. `reward_tier = null` from the raw-observation UPDATE
-- Everything else is byte-identical to the body this replaces.
--
-- After this migration NOTHING in the database writes evaluation.reward_tier.
-- Existing values are deliberately left exactly as they are: this migration
-- updates zero rows. The column is frozen, not cleaned. Any backfill is a
-- separate change with its own approval.
--
-- Note for whoever reads this next: v_rep_performance.rewarded still counts
-- evaluation.reward_tier, so it now reports a frozen legacy column. No UI
-- renders it today. It must be corrected before anything is built that does.

create or replace function public.recompute_evaluation(target uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  y int; n int; na int; applicable int; pct numeric(5,2);
  checklist_ok boolean; nn_ok boolean; ev record;
begin
  select * into ev from public.evaluation where id = target;
  if ev is null then return; end if;

  select count(*) filter (where s.value = 'yes'),
         count(*) filter (where s.value = 'no'),
         count(*) filter (where s.value = 'na')
    into y, n, na
    from public.evaluation_score s
   where s.evaluation_id = target;

  -- Raw observations: counts only, no verdict.
  if ev.kind = 'raw_observation' then
    update public.evaluation
       set yes_count = coalesce(y,0),
           no_count = coalesce(n,0),
           na_count = coalesce(na,0),
           applicable_count = coalesce(y,0) + coalesce(n,0),
           overall_score = null,
           checklist_all_yes = null,
           non_negotiables_all_pass = null
     where id = target;
    return;
  end if;

  applicable := coalesce(y,0) + coalesce(n,0);
  pct := case when applicable > 0
              then round((coalesce(y,0)::numeric / applicable) * 100, 2)
              else null end;

  select bool_and(s.value <> 'no') into checklist_ok
    from public.evaluation_score s
    join public.rubric_criterion c on c.id = s.criterion_id
    join public.rubric_section sec on sec.id = c.section_id
   where s.evaluation_id = target and sec.kind = 'checklist' and s.value is not null;

  select bool_and(s.value <> 'no') into nn_ok
    from public.evaluation_score s
    join public.rubric_criterion c on c.id = s.criterion_id
    join public.rubric_section sec on sec.id = c.section_id
   where s.evaluation_id = target and sec.kind = 'non_negotiable' and s.value is not null;

  update public.evaluation
     set yes_count = coalesce(y,0), no_count = coalesce(n,0), na_count = coalesce(na,0),
         applicable_count = applicable, overall_score = pct,
         checklist_all_yes = checklist_ok, non_negotiables_all_pass = nn_ok
   where id = target;
end;
$function$;
