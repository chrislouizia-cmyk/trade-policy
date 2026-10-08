-- Marketplace surveillance starts with the first real trade opened under the
-- exact strategy revision. Day one is the calendar day of that first trade.
-- Backtests and saved decisions remain evidence, but never start the clock.
alter table public.marketplace_strategy_candidates
  alter column observation_started_at drop not null;

create or replace function public.evaluate_marketplace_strategy_candidate(
  p_source_strategy_id uuid,
  p_source_strategy_revision_id text
) returns public.marketplace_strategy_candidates
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile public.strategy_profiles%rowtype;
  v_policy public.marketplace_qualification_policies%rowtype;
  v_first_trade_at timestamptz;
  v_last_trade_at timestamptz;
  v_backtests integer := 0;
  v_decisions integer := 0;
  v_trades integer := 0;
  v_violations integer := 0;
  v_adherence numeric;
  v_drawdown numeric;
  v_candidate public.marketplace_strategy_candidates%rowtype;
  v_status text;
begin
  if p_source_strategy_id is null or nullif(btrim(p_source_strategy_revision_id),'') is null then raise exception 'Strategy and exact revision are required'; end if;
  select * into v_profile from public.strategy_profiles where id=p_source_strategy_id and is_archived=false;
  if not found then raise exception 'Active strategy profile not found'; end if;
  select * into v_policy from public.marketplace_qualification_policies where active=true limit 1;
  if not found then raise exception 'Active Marketplace qualification policy not found'; end if;

  select count(*)::integer into v_backtests from public.backtest_runs
  where strategy_profile_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id and status='COMPLETED';
  select count(*)::integer into v_decisions from public.decision_reports
  where strategy_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id and user_id=v_profile.user_id;

  -- Opening a real recorded trade starts surveillance, even while it remains open.
  select min(opened_at),max(opened_at) into v_first_trade_at,v_last_trade_at
  from public.active_trades
  where strategy_profile_id=p_source_strategy_id
    and strategy_revision_id=p_source_strategy_revision_id
    and user_id=v_profile.user_id
    and opened_at is not null;

  select count(*)::integer,
         count(*) filter(where coalesce(taken_against_verdict,false))::integer,
         case when count(*)>0 then round(100.0*count(*) filter(where not coalesce(taken_against_verdict,false))/count(*),2) else null end
  into v_trades,v_violations,v_adherence
  from public.active_trades
  where strategy_profile_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id and user_id=v_profile.user_id
    and status='CLOSED' and closed_at is not null and result_r is not null;

  with ordered as (
    select id,coalesce(closed_at,created_at) activity_at,
      sum(result_r) over(order by coalesce(closed_at,created_at),id rows between unbounded preceding and current row) equity_r
    from public.active_trades
    where strategy_profile_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id and user_id=v_profile.user_id
      and status='CLOSED' and closed_at is not null and result_r is not null
  ),peaks as (
    select equity_r,greatest(0,max(equity_r) over(order by activity_at,id rows between unbounded preceding and current row)) peak_r from ordered
  ) select case when v_trades>0 then round(coalesce(max(peak_r-equity_r),0),4) else null end into v_drawdown from peaks;

  update public.marketplace_strategy_candidates set is_current_revision=false,updated_at=now()
  where source_strategy_id=p_source_strategy_id and source_strategy_revision_id<>p_source_strategy_revision_id and is_current_revision=true;

  insert into public.marketplace_strategy_candidates(
    source_strategy_id,owner_user_id,source_strategy_revision_id,qualification_policy_version,
    observation_started_at,last_verified_activity_at,completed_backtests,saved_decisions,closed_trades,
    adherence_percent,critical_violations,maximum_drawdown_r,is_current_revision
  ) values (
    p_source_strategy_id,v_profile.user_id,p_source_strategy_revision_id,v_policy.version,
    v_first_trade_at,v_last_trade_at,v_backtests,v_decisions,v_trades,v_adherence,v_violations,v_drawdown,true
  ) on conflict(source_strategy_id,source_strategy_revision_id) do update set
    qualification_policy_version=excluded.qualification_policy_version,
    observation_started_at=case
      when excluded.observation_started_at is null then null
      when public.marketplace_strategy_candidates.observation_started_at is null then excluded.observation_started_at
      else least(public.marketplace_strategy_candidates.observation_started_at,excluded.observation_started_at)
    end,
    last_verified_activity_at=excluded.last_verified_activity_at,
    completed_backtests=excluded.completed_backtests,saved_decisions=excluded.saved_decisions,closed_trades=excluded.closed_trades,
    adherence_percent=excluded.adherence_percent,critical_violations=excluded.critical_violations,
    maximum_drawdown_r=excluded.maximum_drawdown_r,is_current_revision=true,updated_at=now()
  returning * into v_candidate;

  v_candidate.observation_days:=case when v_candidate.observation_started_at is null then 0
    else greatest(1,1+floor(extract(epoch from (now()-v_candidate.observation_started_at))/86400))::integer end;

  if v_candidate.qualification_status='ARCHIVED' then v_status:='ARCHIVED';
  elsif v_candidate.observation_days<v_policy.minimum_observation_days or v_trades<v_policy.minimum_closed_trades then
    v_status:=case when v_candidate.observation_started_at is null then 'OBSERVING' else 'INSUFFICIENT_DATA' end;
  elsif coalesce(v_adherence,0)<v_policy.minimum_adherence_percent or v_violations>v_policy.maximum_critical_violations or coalesce(v_drawdown,0)>v_policy.maximum_drawdown_r then v_status:='INSUFFICIENT_DATA';
  elsif v_candidate.qualification_status='APPROVED' and v_candidate.owner_consent_status='GRANTED' then v_status:='APPROVED';
  elsif v_candidate.qualification_status='DECLINED' or v_candidate.owner_consent_status in ('DECLINED','REVOKED') then v_status:='DECLINED';
  elsif v_candidate.owner_consent_status='GRANTED' then v_status:='UNDER_REVIEW';
  else v_status:='OWNER_CONSENT_PENDING'; end if;

  update public.marketplace_strategy_candidates set observation_days=v_candidate.observation_days,qualification_status=v_status,
    owner_consent_status=case when v_status='OWNER_CONSENT_PENDING' and owner_consent_status='NOT_REQUESTED' then 'PENDING' else owner_consent_status end,
    qualified_at=case when v_status in ('OWNER_CONSENT_PENDING','UNDER_REVIEW') then coalesce(qualified_at,now()) else qualified_at end,
    updated_at=now() where id=v_candidate.id returning * into v_candidate;
  return v_candidate;
end;
$$;

revoke all on function public.evaluate_marketplace_strategy_candidate(uuid,text) from public,anon,authenticated;
grant execute on function public.evaluate_marketplace_strategy_candidate(uuid,text) to service_role;

comment on function public.evaluate_marketplace_strategy_candidate(uuid,text) is
  'Evaluates exact-revision Marketplace evidence. Surveillance day 1 starts when the first real trade is opened; simulations and decisions never start the clock.';
