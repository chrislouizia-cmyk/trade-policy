-- Sprint A: five-layer engine metadata, AI threshold repair, and rule evaluation mode.

alter table public.strategy_profiles
  add column if not exists engine_version integer not null default 1;

alter table public.strategy_rules
  add column if not exists evaluation_mode text not null default 'AUTOMATIC';

update public.strategy_profiles
set ai_behavior = jsonb_build_object(
  'tone',coalesce(ai_behavior->>'tone','analytical'),
  'strictness',coalesce(ai_behavior->>'strictness','conservative'),
  'confidenceThreshold',case when ai_behavior->>'confidenceThreshold' ~ '^[0-9]+([.][0-9]+)?$' then (ai_behavior->>'confidenceThreshold')::numeric else coalesce(wait_score,70) end,
  'explainDecisions',case when ai_behavior->>'explainDecisions' in ('true','false') then (ai_behavior->>'explainDecisions')::boolean else true end,
  'suggestAlternatives',case when ai_behavior->>'suggestAlternatives' in ('true','false') then (ai_behavior->>'suggestAlternatives')::boolean else true end,
  'useDisplayName',case when ai_behavior->>'useDisplayName' in ('true','false') then (ai_behavior->>'useDisplayName')::boolean else true end
)
where ai_behavior is null
   or not ai_behavior ? 'confidenceThreshold'
   or jsonb_typeof(ai_behavior->'confidenceThreshold') not in ('number','string');

update public.strategy_profiles set engine_version=2
where nullif(trim(macro_timeframe),'') is not null
  and nullif(trim(trend_timeframe),'') is not null
  and nullif(trim(confirmation_timeframe),'') is not null
  and nullif(trim(entry_timeframe),'') is not null
  and nullif(trim(trigger_timeframe),'') is not null;

update public.strategy_rules set evaluation_mode='MANUAL'
where rule_key in ('orderBlock','sessionRequirement','newsFilter','correlationFilter','spreadFilter')
  and evaluation_mode='AUTOMATIC';

do $$ begin
  if not exists(select 1 from pg_constraint where conname='strategy_profiles_engine_version_check' and conrelid='public.strategy_profiles'::regclass) then
    alter table public.strategy_profiles add constraint strategy_profiles_engine_version_check check(engine_version between 1 and 2);
  end if;
  if not exists(select 1 from pg_constraint where conname='strategy_rules_evaluation_mode_check' and conrelid='public.strategy_rules'::regclass) then
    alter table public.strategy_rules add constraint strategy_rules_evaluation_mode_check check(evaluation_mode in ('AUTOMATIC','MANUAL'));
  end if;
end $$;

notify pgrst, 'reload schema';
