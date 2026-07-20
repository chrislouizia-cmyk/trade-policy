-- Lightweight, privacy-bounded Beta Intelligence product instrumentation.

create table if not exists public.beta_intelligence_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  playbook_id uuid,
  event_type text not null check (event_type in (
    'ONBOARDING_STARTED','ONBOARDING_COMPLETED','PLAYBOOK_CREATED','PLAYBOOK_UPDATED',
    'PLAYBOOK_DUPLICATED','PLAYBOOK_ARCHIVED','PLAYBOOK_RESTORED','PLAYBOOK_DELETED',
    'METHODOLOGY_CONFIRMED','METHODOLOGY_REJECTED','SIMULATION_APPROVED','SIMULATION_REJECTED',
    'FIRST_ANALYSIS_STARTED','FIRST_ANALYSIS_COMPLETED','ANALYSIS_COMPLETED','ANALYSIS_ABANDONED'
  )),
  app_version text not null,
  platform text not null check (platform in ('DESKTOP','MOBILE','TABLET','UNKNOWN')),
  session_id uuid not null
);

create index if not exists beta_intelligence_events_type_time_idx on public.beta_intelligence_events(event_type,occurred_at desc);
create index if not exists beta_intelligence_events_user_time_idx on public.beta_intelligence_events(user_id,occurred_at desc);
create unique index if not exists beta_intelligence_first_event_once_idx on public.beta_intelligence_events(user_id,event_type)
where event_type in ('FIRST_ANALYSIS_STARTED','FIRST_ANALYSIS_COMPLETED');

alter table public.beta_intelligence_events enable row level security;
revoke all on public.beta_intelligence_events from public,authenticated;

create or replace function public.log_beta_intelligence_event(
  p_event_type text,
  p_playbook_id uuid,
  p_app_version text,
  p_platform text,
  p_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_event_type not in ('ONBOARDING_STARTED','ONBOARDING_COMPLETED','PLAYBOOK_CREATED','PLAYBOOK_UPDATED','PLAYBOOK_DUPLICATED','PLAYBOOK_ARCHIVED','PLAYBOOK_RESTORED','PLAYBOOK_DELETED','METHODOLOGY_CONFIRMED','METHODOLOGY_REJECTED','SIMULATION_APPROVED','SIMULATION_REJECTED','ANALYSIS_COMPLETED','ANALYSIS_ABANDONED') then raise exception 'Unsupported Beta Intelligence event'; end if;
  if p_platform not in ('DESKTOP','MOBILE','TABLET','UNKNOWN') then raise exception 'Unsupported platform'; end if;
  if p_playbook_id is not null and not exists(select 1 from public.strategy_profiles where id=p_playbook_id and user_id=v_user_id) and p_event_type<>'PLAYBOOK_DELETED' then raise exception 'Playbook unavailable'; end if;

  insert into public.beta_intelligence_events(user_id,occurred_at,playbook_id,event_type,app_version,platform,session_id)
  values(v_user_id,v_now,p_playbook_id,p_event_type,left(p_app_version,40),p_platform,p_session_id);

  if p_event_type='ANALYSIS_COMPLETED' then
    insert into public.beta_intelligence_events(user_id,occurred_at,playbook_id,event_type,app_version,platform,session_id)
    values(v_user_id,v_now,p_playbook_id,'FIRST_ANALYSIS_COMPLETED',left(p_app_version,40),p_platform,p_session_id)
    on conflict (user_id,event_type) where event_type in ('FIRST_ANALYSIS_STARTED','FIRST_ANALYSIS_COMPLETED') do nothing;
  end if;
end;
$$;

-- Analysis start is deliberately separate so abandoned attempts can be measured.
create or replace function public.log_beta_analysis_started(p_playbook_id uuid,p_app_version text,p_platform text,p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_user_id uuid:=auth.uid();v_now timestamptz:=now();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_platform not in ('DESKTOP','MOBILE','TABLET','UNKNOWN') then raise exception 'Unsupported platform'; end if;
  if p_playbook_id is not null and not exists(select 1 from public.strategy_profiles where id=p_playbook_id and user_id=v_user_id) then raise exception 'Playbook unavailable'; end if;
  insert into public.beta_intelligence_events(user_id,occurred_at,playbook_id,event_type,app_version,platform,session_id) values(v_user_id,v_now,p_playbook_id,'FIRST_ANALYSIS_STARTED',left(p_app_version,40),p_platform,p_session_id) on conflict (user_id,event_type) where event_type in ('FIRST_ANALYSIS_STARTED','FIRST_ANALYSIS_COMPLETED') do nothing;
end;$$;

create or replace function public.staff_beta_intelligence_metrics()
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.has_staff_permission('system.health') then raise exception 'System health permission required'; end if;
  with counts as (select event_type,count(*)::numeric n from public.beta_intelligence_events group by event_type),
  durations as (select started.user_id,started.session_id,extract(epoch from min(completed.occurred_at)-min(started.occurred_at)) seconds from public.beta_intelligence_events started join public.beta_intelligence_events completed on completed.user_id=started.user_id and completed.session_id=started.session_id and completed.event_type='ONBOARDING_COMPLETED' where started.event_type='ONBOARDING_STARTED' group by started.user_id,started.session_id)
  select jsonb_build_object(
    'onboardingCompletionRate',round(100*coalesce((select n from counts where event_type='ONBOARDING_COMPLETED'),0)/nullif(coalesce((select n from counts where event_type='ONBOARDING_STARTED'),0),0),1),
    'methodologyRejectionRate',round(100*coalesce((select n from counts where event_type='METHODOLOGY_REJECTED'),0)/nullif(coalesce((select sum(n) from counts where event_type in ('METHODOLOGY_CONFIRMED','METHODOLOGY_REJECTED')),0),0),1),
    'simulationAcceptanceRate',round(100*coalesce((select n from counts where event_type='SIMULATION_APPROVED'),0)/nullif(coalesce((select sum(n) from counts where event_type in ('SIMULATION_APPROVED','SIMULATION_REJECTED')),0),0),1),
    'firstAnalysisCompletionRate',round(100*coalesce((select n from counts where event_type='FIRST_ANALYSIS_COMPLETED'),0)/nullif(coalesce((select n from counts where event_type='FIRST_ANALYSIS_STARTED'),0),0),1),
    'averageOnboardingDurationSeconds',round(coalesce((select avg(seconds) from durations where seconds>=0),0)::numeric,1),
    'eventCount',(select count(*) from public.beta_intelligence_events)
  ) into result;
  return result;
end;$$;

revoke all on function public.log_beta_intelligence_event(text,uuid,text,text,uuid) from public;
revoke all on function public.log_beta_analysis_started(uuid,text,text,uuid) from public;
revoke all on function public.staff_beta_intelligence_metrics() from public;
grant execute on function public.log_beta_intelligence_event(text,uuid,text,text,uuid) to authenticated;
grant execute on function public.log_beta_analysis_started(uuid,text,text,uuid) to authenticated;
grant execute on function public.staff_beta_intelligence_metrics() to authenticated;

notify pgrst, 'reload schema';
