-- Marketplace M1 completion:
-- 1. observation belongs to the strategy across revisions;
-- 2. approved customer releases can be safely discovered and installed;
-- 3. deleting an editable strategy preserves its immutable Marketplace evidence.

create table if not exists public.marketplace_strategy_observation_clocks (
  source_strategy_id uuid primary key references public.strategy_profiles(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  first_trade_at timestamptz not null,
  last_trade_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_trade_at >= first_trade_at)
);

alter table public.marketplace_strategy_observation_clocks enable row level security;
revoke all on public.marketplace_strategy_observation_clocks from public, anon, authenticated;
grant select, insert, update, delete on public.marketplace_strategy_observation_clocks to service_role;

insert into public.marketplace_strategy_observation_clocks(
  source_strategy_id, owner_user_id, first_trade_at, last_trade_at
)
select strategy_profile_id, user_id, min(opened_at), max(opened_at)
from public.active_trades
where strategy_profile_id is not null and opened_at is not null
group by strategy_profile_id, user_id
on conflict(source_strategy_id) do update set
  first_trade_at=least(public.marketplace_strategy_observation_clocks.first_trade_at, excluded.first_trade_at),
  last_trade_at=greatest(public.marketplace_strategy_observation_clocks.last_trade_at, excluded.last_trade_at),
  updated_at=now();

-- Make every existing candidate and published metric correct immediately;
-- users do not need to open each strategy or wait for the next sync.
update public.marketplace_strategy_candidates candidate set
  observation_started_at=clock.first_trade_at,
  last_verified_activity_at=clock.last_trade_at,
  observation_days=greatest(1,1+floor(extract(epoch from(now()-clock.first_trade_at))/86400))::integer,
  updated_at=now()
from public.marketplace_strategy_observation_clocks clock
where candidate.source_strategy_id=clock.source_strategy_id;

update public.marketplace_release_verified_metrics metric set
  observation_started_at=clock.first_trade_at,
  last_verified_activity_at=greatest(coalesce(metric.last_verified_activity_at,clock.last_trade_at),clock.last_trade_at),
  observation_days=greatest(1,1+floor(extract(epoch from(now()-clock.first_trade_at))/86400))::integer,
  updated_at=now()
from public.marketplace_strategy_observation_clocks clock
where metric.source_strategy_id=clock.source_strategy_id;

create or replace function public.capture_marketplace_strategy_observation_clock()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.strategy_profile_id is not null and new.opened_at is not null then
    insert into public.marketplace_strategy_observation_clocks(
      source_strategy_id, owner_user_id, first_trade_at, last_trade_at
    ) values(new.strategy_profile_id,new.user_id,new.opened_at,new.opened_at)
    on conflict(source_strategy_id) do update set
      first_trade_at=least(public.marketplace_strategy_observation_clocks.first_trade_at,excluded.first_trade_at),
      last_trade_at=greatest(public.marketplace_strategy_observation_clocks.last_trade_at,excluded.last_trade_at),
      updated_at=now();
  end if;
  return new;
end;$$;
revoke all on function public.capture_marketplace_strategy_observation_clock() from public,anon,authenticated;
drop trigger if exists active_trade_marketplace_clock on public.active_trades;
create trigger active_trade_marketplace_clock after insert or update of strategy_profile_id,opened_at
on public.active_trades for each row execute function public.capture_marketplace_strategy_observation_clock();

create or replace function public.evaluate_marketplace_strategy_candidate(
  p_source_strategy_id uuid,p_source_strategy_revision_id text
) returns public.marketplace_strategy_candidates
language plpgsql security invoker set search_path=public as $$
declare
  v_profile public.strategy_profiles%rowtype; v_policy public.marketplace_qualification_policies%rowtype;
  v_first_trade_at timestamptz; v_last_trade_at timestamptz;
  v_backtests integer:=0; v_decisions integer:=0; v_trades integer:=0; v_violations integer:=0;
  v_adherence numeric; v_drawdown numeric; v_candidate public.marketplace_strategy_candidates%rowtype; v_status text;
begin
  if p_source_strategy_id is null or nullif(btrim(p_source_strategy_revision_id),'') is null then raise exception 'Strategy and exact revision are required'; end if;
  select * into v_profile from public.strategy_profiles where id=p_source_strategy_id and is_archived=false;
  if not found then raise exception 'Active strategy profile not found'; end if;
  select * into v_policy from public.marketplace_qualification_policies where active=true limit 1;
  if not found then raise exception 'Active Marketplace qualification policy not found'; end if;

  select first_trade_at,last_trade_at into v_first_trade_at,v_last_trade_at
  from public.marketplace_strategy_observation_clocks where source_strategy_id=p_source_strategy_id;
  if v_first_trade_at is null then
    select min(opened_at),max(opened_at) into v_first_trade_at,v_last_trade_at from public.active_trades
    where strategy_profile_id=p_source_strategy_id and user_id=v_profile.user_id and opened_at is not null;
    if v_first_trade_at is not null then
      insert into public.marketplace_strategy_observation_clocks(source_strategy_id,owner_user_id,first_trade_at,last_trade_at)
      values(p_source_strategy_id,v_profile.user_id,v_first_trade_at,v_last_trade_at)
      on conflict(source_strategy_id) do update set first_trade_at=least(public.marketplace_strategy_observation_clocks.first_trade_at,excluded.first_trade_at),last_trade_at=greatest(public.marketplace_strategy_observation_clocks.last_trade_at,excluded.last_trade_at),updated_at=now();
    end if;
  end if;

  select count(*)::integer into v_backtests from public.backtest_runs where strategy_profile_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id and status='COMPLETED';
  select count(*)::integer into v_decisions from public.decision_reports where strategy_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id and user_id=v_profile.user_id;
  select count(*)::integer,count(*) filter(where coalesce(taken_against_verdict,false))::integer,
    case when count(*)>0 then round(100.0*count(*) filter(where not coalesce(taken_against_verdict,false))/count(*),2) else null end
  into v_trades,v_violations,v_adherence from public.active_trades
  where strategy_profile_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id and user_id=v_profile.user_id and status='CLOSED' and closed_at is not null and result_r is not null;
  with ordered as (
    select id,coalesce(closed_at,created_at) activity_at,sum(result_r) over(order by coalesce(closed_at,created_at),id rows between unbounded preceding and current row) equity_r
    from public.active_trades where strategy_profile_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id and user_id=v_profile.user_id and status='CLOSED' and closed_at is not null and result_r is not null
  ),peaks as(select equity_r,greatest(0,max(equity_r) over(order by activity_at,id rows between unbounded preceding and current row)) peak_r from ordered)
  select case when v_trades>0 then round(coalesce(max(peak_r-equity_r),0),4) else null end into v_drawdown from peaks;

  update public.marketplace_strategy_candidates set is_current_revision=false,updated_at=now() where source_strategy_id=p_source_strategy_id and source_strategy_revision_id<>p_source_strategy_revision_id and is_current_revision=true;
  insert into public.marketplace_strategy_candidates(source_strategy_id,owner_user_id,source_strategy_revision_id,qualification_policy_version,observation_started_at,last_verified_activity_at,completed_backtests,saved_decisions,closed_trades,adherence_percent,critical_violations,maximum_drawdown_r,is_current_revision)
  values(p_source_strategy_id,v_profile.user_id,p_source_strategy_revision_id,v_policy.version,v_first_trade_at,v_last_trade_at,v_backtests,v_decisions,v_trades,v_adherence,v_violations,v_drawdown,true)
  on conflict(source_strategy_id,source_strategy_revision_id) do update set qualification_policy_version=excluded.qualification_policy_version,observation_started_at=excluded.observation_started_at,last_verified_activity_at=excluded.last_verified_activity_at,completed_backtests=excluded.completed_backtests,saved_decisions=excluded.saved_decisions,closed_trades=excluded.closed_trades,adherence_percent=excluded.adherence_percent,critical_violations=excluded.critical_violations,maximum_drawdown_r=excluded.maximum_drawdown_r,is_current_revision=true,updated_at=now()
  returning * into v_candidate;
  v_candidate.observation_days:=case when v_first_trade_at is null then 0 else greatest(1,1+floor(extract(epoch from(now()-v_first_trade_at))/86400))::integer end;
  if v_candidate.qualification_status='ARCHIVED' then v_status:='ARCHIVED';
  elsif v_candidate.observation_days<v_policy.minimum_observation_days or v_trades<v_policy.minimum_closed_trades then v_status:=case when v_first_trade_at is null then 'OBSERVING' else 'INSUFFICIENT_DATA' end;
  elsif coalesce(v_adherence,0)<v_policy.minimum_adherence_percent or v_violations>v_policy.maximum_critical_violations or coalesce(v_drawdown,0)>v_policy.maximum_drawdown_r then v_status:='INSUFFICIENT_DATA';
  elsif v_candidate.qualification_status='APPROVED' and v_candidate.owner_consent_status='GRANTED' then v_status:='APPROVED';
  elsif v_candidate.qualification_status='DECLINED' or v_candidate.owner_consent_status in('DECLINED','REVOKED') then v_status:='DECLINED';
  elsif v_candidate.owner_consent_status='GRANTED' then v_status:='UNDER_REVIEW'; else v_status:='OWNER_CONSENT_PENDING'; end if;
  update public.marketplace_strategy_candidates set observation_days=v_candidate.observation_days,qualification_status=v_status,owner_consent_status=case when v_status='OWNER_CONSENT_PENDING' and owner_consent_status='NOT_REQUESTED' then 'PENDING' else owner_consent_status end,qualified_at=case when v_status in('OWNER_CONSENT_PENDING','UNDER_REVIEW') then coalesce(qualified_at,now()) else qualified_at end,updated_at=now() where id=v_candidate.id returning * into v_candidate;
  return v_candidate;
end;$$;
revoke all on function public.evaluate_marketplace_strategy_candidate(uuid,text) from public,anon,authenticated;
grant execute on function public.evaluate_marketplace_strategy_candidate(uuid,text) to service_role;

-- Preserve the immutable release and its snapshot when its editable source is deleted.
alter table public.marketplace_strategy_releases add column if not exists source_strategy_origin_id uuid;
alter table public.marketplace_strategy_releases disable trigger marketplace_release_immutable_update;
update public.marketplace_strategy_releases set source_strategy_origin_id=source_strategy_id where source_strategy_origin_id is null;
alter table public.marketplace_strategy_releases enable trigger marketplace_release_immutable_update;
alter table public.marketplace_strategy_releases alter column source_strategy_origin_id set not null;
alter table public.marketplace_strategy_releases alter column source_strategy_id drop not null;
alter table public.marketplace_strategy_releases drop constraint if exists marketplace_strategy_releases_source_strategy_id_fkey;
alter table public.marketplace_strategy_releases add constraint marketplace_strategy_releases_source_strategy_id_fkey foreign key(source_strategy_id) references public.strategy_profiles(id) on delete set null;

alter table public.marketplace_release_verified_metrics add column if not exists source_strategy_origin_id uuid;
update public.marketplace_release_verified_metrics set source_strategy_origin_id=source_strategy_id where source_strategy_origin_id is null;
alter table public.marketplace_release_verified_metrics alter column source_strategy_origin_id set not null;
alter table public.marketplace_release_verified_metrics alter column source_strategy_id drop not null;
alter table public.marketplace_release_verified_metrics drop constraint if exists marketplace_release_verified_metrics_source_strategy_id_fkey;
alter table public.marketplace_release_verified_metrics add constraint marketplace_release_verified_metrics_source_strategy_id_fkey foreign key(source_strategy_id) references public.strategy_profiles(id) on delete set null;

create or replace function public.allow_marketplace_release_source_detach()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.source_strategy_id is not null and new.source_strategy_id is null
    and (to_jsonb(new)-'source_strategy_id')=(to_jsonb(old)-'source_strategy_id') then return new; end if;
  raise exception 'Marketplace releases are immutable';
end;$$;
drop trigger if exists marketplace_release_immutable_update on public.marketplace_strategy_releases;
create trigger marketplace_release_immutable_update before update on public.marketplace_strategy_releases for each row execute function public.allow_marketplace_release_source_detach();

alter table public.marketplace_listings drop constraint if exists marketplace_listings_visibility_check;
alter table public.marketplace_listings add constraint marketplace_listings_visibility_check check(visibility in('INTERNAL','PUBLIC'));
alter table public.marketplace_installs drop constraint if exists marketplace_installs_entitlement_mode_check;
alter table public.marketplace_installs add constraint marketplace_installs_entitlement_mode_check check(entitlement_mode in('SIMULATED_INTERNAL','FREE_PUBLIC'));

-- Compliance approval publishes customer releases; internal lab releases stay internal.
create or replace function public.staff_marketplace_transition_listing(p_listing_id uuid,p_review_status text,p_note text,p_actor_user_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare l public.marketplace_listings%rowtype; r public.marketplace_strategy_releases%rowtype; allowed text[];
begin
  select * into l from public.marketplace_listings where id=p_listing_id for update; if not found then raise exception 'Marketplace listing not found'; end if;
  select * into r from public.marketplace_strategy_releases where id=l.release_id;
  allowed:=case l.review_status when 'DRAFT' then array['IN_REVIEW','ARCHIVED'] when 'IN_REVIEW' then array['APPROVED','REJECTED'] when 'APPROVED' then array['ARCHIVED'] when 'REJECTED' then array['IN_REVIEW','ARCHIVED'] else array[]::text[] end;
  if not(p_review_status=any(allowed)) then raise exception 'Marketplace review transition from % to % is not allowed',l.review_status,p_review_status; end if;
  if p_review_status in('APPROVED','REJECTED') and nullif(btrim(p_note),'') is null then raise exception 'A review note is required'; end if;
  update public.marketplace_listings set review_status=p_review_status,visibility=case when p_review_status='APPROVED' and r.source_type='CUSTOMER_BETA' then 'PUBLIC' else visibility end,updated_at=now() where id=l.id;
  update public.marketplace_strategy_candidates set qualification_status=case p_review_status when 'APPROVED' then 'APPROVED' when 'REJECTED' then 'DECLINED' when 'ARCHIVED' then 'ARCHIVED' else 'UNDER_REVIEW' end,updated_at=now()
  where r.source_type='CUSTOMER_BETA' and source_strategy_id=r.source_strategy_id and source_strategy_revision_id=r.source_strategy_revision_id;
  insert into public.marketplace_review_events(release_id,actor_user_id,actor_scope,event_type,note) values(l.release_id,p_actor_user_id,'COMPLIANCE','REVIEW_'||p_review_status,nullif(btrim(p_note),''));
  return jsonb_build_object('listingId',l.id,'releaseId',l.release_id,'previousStatus',l.review_status,'reviewStatus',p_review_status,'visibility',case when p_review_status='APPROVED' and r.source_type='CUSTOMER_BETA' then 'PUBLIC' else l.visibility end);
end;$$;
revoke all on function public.staff_marketplace_transition_listing(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.staff_marketplace_transition_listing(uuid,text,text,uuid) to service_role;

create or replace function public.install_public_marketplace_strategy(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); l public.marketplace_listings%rowtype; r public.marketplace_strategy_releases%rowtype; i public.marketplace_installs%rowtype; s jsonb; new_strategy uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  select * into l from public.marketplace_listings where id=p_listing_id and visibility='PUBLIC' and review_status='APPROVED' and commerce_enabled=false for update;
  if not found then raise exception 'Public approved listing not found'; end if;
  select * into r from public.marketplace_strategy_releases where id=l.release_id and source_type='CUSTOMER_BETA' and eligibility_status in('UNDER_REVIEW','APPROVED','LISTED');
  if not found then raise exception 'Licensed release is unavailable'; end if;
  select * into i from public.marketplace_installs where release_id=r.id and installer_user_id=uid;
  if found then return jsonb_build_object('installId',i.id,'releaseId',r.id,'installedStrategyId',i.installed_strategy_id,'chargedCents',0,'entitlementMode',i.entitlement_mode,'active',false,'alreadyInstalled',true); end if;
  s:=r.snapshot_json->'licensedStrategy'; if s is null or jsonb_typeof(s)<>'object' then raise exception 'Licensed strategy snapshot is unavailable'; end if;
  insert into public.marketplace_installs(release_id,installer_user_id,entitlement_mode,charged_cents,status) values(r.id,uid,'FREE_PUBLIC',0,'INSTALLED') returning * into i;
  insert into public.strategy_profiles(user_id,name,is_default,market_types,instruments,trend_timeframe,confirmation_timeframe,entry_timeframe,macro_timeframe,trigger_timeframe,minimum_rr,maximum_risk_percent,maximum_trades_per_day,allowed_sessions,evidence_weights,required_evidence,stop_limits,authorization_score,wait_score,loss_streak_limit,marketplace_source_release_id,marketplace_install_id)
  values(uid,coalesce(nullif(s->>'name',''),'Installed strategy'),false,coalesce(array(select jsonb_array_elements_text(s->'marketTypes')),array[]::text[]),coalesce(array(select jsonb_array_elements_text(s->'instruments')),array[]::text[]),coalesce(s->>'trendTimeframe',''),coalesce(s->>'confirmationTimeframe',''),coalesce(s->>'entryTimeframe',''),nullif(s->>'macroTimeframe',''),nullif(s->>'triggerTimeframe',''),coalesce((s->>'minimumRR')::numeric,0),coalesce((s->>'maximumRiskPercent')::numeric,0),coalesce((s->>'maximumTradesPerDay')::integer,2),coalesce(array(select jsonb_array_elements_text(s->'allowedSessions')),array[]::text[]),coalesce(s->'evidenceWeights','{}'::jsonb),coalesce(array(select jsonb_array_elements_text(s->'requiredEvidence')),array[]::text[]),coalesce(s->'stopLimits','{}'::jsonb),coalesce((s->>'authorizationScore')::integer,80),coalesce((s->>'waitScore')::integer,70),coalesce((s->>'lossStreakLimit')::integer,5),r.id,i.id) returning id into new_strategy;
  insert into public.strategy_instruments(strategy_id,user_id,symbol,market_type,provider_symbol,sort_order,enabled) select new_strategy,uid,x.value,coalesce(s->'marketTypes'->>0,'FOREX'),x.value,x.ordinality::integer,true from jsonb_array_elements_text(coalesce(s->'instruments','[]'::jsonb)) with ordinality x(value,ordinality);
  insert into public.strategy_sessions(strategy_id,user_id,session_code,name,timezone,start_time,end_time,days,allow_open_outside,allow_hold_outside,is_custom) select new_strategy,uid,x."sessionCode",x.name,x.timezone,x."startTime"::time,x."endTime"::time,x.days,x."allowOpenOutside",x."allowHoldOutside",x."isCustom" from jsonb_to_recordset(coalesce(s->'sessions','[]'::jsonb)) as x("sessionCode" text,name text,timezone text,"startTime" text,"endTime" text,days smallint[],"allowOpenOutside" boolean,"allowHoldOutside" boolean,"isCustom" boolean);
  insert into public.strategy_rules(strategy_id,user_id,rule_key,label,enabled,mandatory,weight,minimum_confidence,timeframe_role,configuration,sort_order,evaluation_mode) select new_strategy,uid,x.value->>'ruleKey',x.value->>'label',coalesce((x.value->>'enabled')::boolean,true),coalesce((x.value->>'mandatory')::boolean,false),coalesce((x.value->>'weight')::numeric,0),coalesce((x.value->>'minimumConfidence')::integer,0),x.value->>'timeframeRole','{}'::jsonb,x.ordinality::integer,coalesce(x.value->>'evaluationMode','AUTOMATIC') from jsonb_array_elements(coalesce(s->'rules','[]'::jsonb)) with ordinality x(value,ordinality);
  insert into public.strategy_stop_limits(strategy_id,user_id,instrument,method,minimum_value,preferred_value,maximum_value,atr_multiplier,configuration) select new_strategy,uid,x.instrument,x.method,x."minimumValue",x."preferredValue",x."maximumValue",x."atrMultiplier",'{}'::jsonb from jsonb_to_recordset(coalesce(s->'stopLimitSettings','[]'::jsonb)) as x(instrument text,method text,"minimumValue" numeric,"preferredValue" numeric,"maximumValue" numeric,"atrMultiplier" numeric);
  update public.marketplace_installs set installed_strategy_id=new_strategy where id=i.id;
  insert into public.marketplace_review_events(release_id,actor_user_id,actor_scope,event_type,note) values(r.id,uid,'SYSTEM','PUBLIC_FREE_INSTALL','Inactive licensed copy installed from immutable approved release.');
  return jsonb_build_object('installId',i.id,'releaseId',r.id,'installedStrategyId',new_strategy,'chargedCents',0,'entitlementMode','FREE_PUBLIC','active',false,'alreadyInstalled',false);
end;$$;
revoke all on function public.install_public_marketplace_strategy(uuid) from public,anon;
grant execute on function public.install_public_marketplace_strategy(uuid) to authenticated;

-- Delete the editable strategy, archive future discovery, and keep immutable releases/history.
create or replace function public.delete_strategy_playbook(p_strategy_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); s public.strategy_profiles%rowtype; fallback_id uuid; release_count integer:=0; trade_count integer:=0; active_count integer:=0; scan_count integer:=0; report_count integer:=0; backtest_count integer:=0;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  select * into s from public.strategy_profiles where id=p_strategy_id and user_id=uid for update; if not found then raise exception 'Playbook not found'; end if;
  if s.is_default then select id into fallback_id from public.strategy_profiles where user_id=uid and id<>p_strategy_id and is_archived=false order by created_at limit 1 for update; end if;
  update public.marketplace_listings l set review_status='ARCHIVED',updated_at=now() from public.marketplace_strategy_releases r where l.release_id=r.id and r.source_strategy_id=p_strategy_id and r.creator_user_id=uid and l.review_status<>'ARCHIVED';
  insert into public.marketplace_review_events(release_id,actor_user_id,actor_scope,event_type,note) select id,uid,'SYSTEM','SOURCE_STRATEGY_DELETED','Editable source deleted by its owner; immutable release and historical evidence preserved.' from public.marketplace_strategy_releases where source_strategy_id=p_strategy_id and creator_user_id=uid;
  select count(*)::integer into release_count from public.marketplace_strategy_releases where source_strategy_id=p_strategy_id and creator_user_id=uid;
  update public.trade_records set strategy_profile_id=null where user_id=uid and strategy_profile_id=p_strategy_id; get diagnostics trade_count=row_count;
  update public.active_trades set strategy_profile_id=null where user_id=uid and strategy_profile_id=p_strategy_id; get diagnostics active_count=row_count;
  update public.market_scans set strategy_profile_id=null where user_id=uid and strategy_profile_id=p_strategy_id; get diagnostics scan_count=row_count;
  select count(*)::integer into report_count from public.decision_reports where user_id=uid and strategy_id=p_strategy_id;
  update public.backtest_runs set strategy_profile_id=null where user_id=uid and strategy_profile_id=p_strategy_id; get diagnostics backtest_count=row_count;
  delete from public.strategy_profiles where id=p_strategy_id and user_id=uid; if not found then raise exception 'Playbook could not be deleted'; end if;
  if s.is_default and fallback_id is not null then update public.strategy_profiles set is_default=true,updated_at=now() where id=fallback_id and user_id=uid and is_archived=false; end if;
  return jsonb_build_object('deleted',true,'strategyId',p_strategy_id,'fallbackStrategyId',fallback_id,'preservedMarketplaceReleases',release_count,'detachedTradeRecords',trade_count,'detachedActiveTrades',active_count,'detachedMarketScans',scan_count,'detachedDecisionReports',report_count,'detachedBacktestRuns',backtest_count);
end;$$;
revoke all on function public.delete_strategy_playbook(uuid) from public,anon;
grant execute on function public.delete_strategy_playbook(uuid) to authenticated;

notify pgrst,'reload schema';
