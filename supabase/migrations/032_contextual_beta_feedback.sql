-- Contextual feedback after analysis and lightweight playbook-rule edit counters.

create table if not exists public.contextual_analysis_feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid not null,
  playbook_id uuid,
  response text not null check(response in ('EXACTLY','MOSTLY','NOT_REALLY')),
  category text check(category in ('MISSING_CONFIRMATION','WRONG_INTERPRETATION','MISSING_INDICATOR','RISK_MANAGEMENT','TIMING','OTHER')),
  comment text check(char_length(comment)<=1000),
  app_version text not null,
  created_at timestamptz not null default now(),
  unique(user_id,analysis_id)
);

create table if not exists public.playbook_rule_edit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  playbook_id uuid not null,
  rule_key text not null,
  edited_at timestamptz not null default now()
);

create index if not exists contextual_feedback_category_idx on public.contextual_analysis_feedback(category,created_at desc);
create index if not exists playbook_rule_edits_rule_idx on public.playbook_rule_edit_events(rule_key,edited_at desc);
alter table public.contextual_analysis_feedback enable row level security;
alter table public.playbook_rule_edit_events enable row level security;
revoke all on public.contextual_analysis_feedback from public,authenticated;
revoke all on public.playbook_rule_edit_events from public,authenticated;

create or replace function public.contextual_feedback_eligibility(p_analysis_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user_id uuid:=auth.uid();v_count integer;v_exists boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select count(*) into v_count from public.beta_intelligence_events where user_id=v_user_id and event_type='ANALYSIS_COMPLETED';
  select exists(select 1 from public.contextual_analysis_feedback where user_id=v_user_id and analysis_id=p_analysis_id) into v_exists;
  return jsonb_build_object('eligible',v_count>=5 and not v_exists,'completedAnalysisCount',v_count);
end;$$;

create or replace function public.save_contextual_analysis_feedback(p_analysis_id uuid,p_playbook_id uuid,p_response text,p_category text,p_comment text,p_app_version text)
returns void language plpgsql security definer set search_path=public as $$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_response not in ('EXACTLY','MOSTLY','NOT_REALLY') then raise exception 'Unsupported feedback response'; end if;
  if p_response<>'EXACTLY' and p_category not in ('MISSING_CONFIRMATION','WRONG_INTERPRETATION','MISSING_INDICATOR','RISK_MANAGEMENT','TIMING','OTHER') then raise exception 'Feedback category required'; end if;
  if p_playbook_id is not null and not exists(select 1 from public.strategy_profiles where id=p_playbook_id and user_id=v_user_id) then raise exception 'Playbook unavailable'; end if;
  if not exists(select 1 from public.market_scans where id=p_analysis_id and user_id=v_user_id) then raise exception 'Analysis unavailable'; end if;
  insert into public.contextual_analysis_feedback(user_id,analysis_id,playbook_id,response,category,comment,app_version)
  values(v_user_id,p_analysis_id,p_playbook_id,p_response,case when p_response='EXACTLY' then null else p_category end,nullif(left(trim(coalesce(p_comment,'')),1000),''),left(p_app_version,40))
  on conflict(user_id,analysis_id) do nothing;
end;$$;

create or replace function public.record_playbook_rule_edits(p_playbook_id uuid,p_rule_keys text[])
returns void language plpgsql security definer set search_path=public as $$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.strategy_profiles where id=p_playbook_id and user_id=v_user_id) then raise exception 'Playbook unavailable'; end if;
  insert into public.playbook_rule_edit_events(user_id,playbook_id,rule_key)
  select v_user_id,p_playbook_id,left(item.rule_key,120)
  from unnest(coalesce(p_rule_keys,'{}'::text[])) as item(rule_key)
  where nullif(trim(item.rule_key),'') is not null;
end;$$;

create or replace function public.staff_contextual_feedback_metrics()
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.has_staff_permission('system.health') then raise exception 'System health permission required'; end if;
  select jsonb_build_object(
    'topMissingConfirmations',coalesce((select jsonb_agg(x) from (select comment label,count(*) count from public.contextual_analysis_feedback where category='MISSING_CONFIRMATION' and comment is not null group by comment order by count(*) desc limit 8)x),'[]'::jsonb),
    'mostEditedPlaybookRules',coalesce((select jsonb_agg(x) from (select rule_key label,count(*) count from public.playbook_rule_edit_events group by rule_key order by count(*) desc limit 8)x),'[]'::jsonb),
    'mostRejectedSimulations',coalesce((select jsonb_agg(x) from (select coalesce(sp.name,left(e.playbook_id::text,8),'Unknown playbook') label,count(*) count from public.beta_intelligence_events e left join public.strategy_profiles sp on sp.id=e.playbook_id where e.event_type='SIMULATION_REJECTED' group by sp.name,e.playbook_id order by count(*) desc limit 8)x),'[]'::jsonb),
    'mostCommonFeedbackCategories',coalesce((select jsonb_agg(x) from (select category label,count(*) count from public.contextual_analysis_feedback where category is not null group by category order by count(*) desc limit 8)x),'[]'::jsonb)
  ) into result;
  return result;
end;$$;

revoke all on function public.contextual_feedback_eligibility(uuid) from public;
revoke all on function public.save_contextual_analysis_feedback(uuid,uuid,text,text,text,text) from public;
revoke all on function public.record_playbook_rule_edits(uuid,text[]) from public;
revoke all on function public.staff_contextual_feedback_metrics() from public;
grant execute on function public.contextual_feedback_eligibility(uuid) to authenticated;
grant execute on function public.save_contextual_analysis_feedback(uuid,uuid,text,text,text,text) to authenticated;
grant execute on function public.record_playbook_rule_edits(uuid,text[]) to authenticated;
grant execute on function public.staff_contextual_feedback_metrics() to authenticated;

notify pgrst, 'reload schema';
