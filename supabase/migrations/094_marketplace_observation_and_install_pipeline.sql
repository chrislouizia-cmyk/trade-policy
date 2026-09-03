-- Private-by-default Marketplace observation and safe internal licensing pipeline.
-- Strategies are evaluated automatically, but publication always requires owner consent and review.

create table if not exists public.marketplace_qualification_policies (
  version text primary key,
  minimum_observation_days integer not null check (minimum_observation_days >= 1),
  minimum_closed_trades integer not null check (minimum_closed_trades >= 1),
  minimum_adherence_percent numeric not null check (minimum_adherence_percent between 0 and 100),
  maximum_critical_violations integer not null check (maximum_critical_violations >= 0),
  maximum_drawdown_r numeric not null check (maximum_drawdown_r > 0),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.marketplace_qualification_policies(
  version,minimum_observation_days,minimum_closed_trades,minimum_adherence_percent,
  maximum_critical_violations,maximum_drawdown_r,active
) values ('MARKETPLACE_QUALIFICATION_V1',180,100,90,0,12,true)
on conflict(version) do update set
  minimum_observation_days=excluded.minimum_observation_days,
  minimum_closed_trades=excluded.minimum_closed_trades,
  minimum_adherence_percent=excluded.minimum_adherence_percent,
  maximum_critical_violations=excluded.maximum_critical_violations,
  maximum_drawdown_r=excluded.maximum_drawdown_r,
  active=true;

create unique index if not exists marketplace_one_active_qualification_policy
  on public.marketplace_qualification_policies(active) where active=true;

create table if not exists public.marketplace_strategy_candidates (
  id uuid primary key default gen_random_uuid(),
  source_strategy_id uuid not null references public.strategy_profiles(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_strategy_revision_id text not null,
  qualification_policy_version text not null references public.marketplace_qualification_policies(version),
  observation_started_at timestamptz not null default now(),
  last_verified_activity_at timestamptz,
  observation_days integer not null default 0,
  completed_backtests integer not null default 0,
  saved_decisions integer not null default 0,
  closed_trades integer not null default 0,
  adherence_percent numeric,
  critical_violations integer not null default 0,
  maximum_drawdown_r numeric,
  qualification_status text not null default 'OBSERVING' check (qualification_status in ('OBSERVING','INSUFFICIENT_DATA','QUALIFIED','OWNER_CONSENT_PENDING','UNDER_REVIEW','APPROVED','DECLINED','ARCHIVED')),
  owner_consent_status text not null default 'NOT_REQUESTED' check (owner_consent_status in ('NOT_REQUESTED','PENDING','GRANTED','DECLINED','REVOKED')),
  owner_consent_version text,
  owner_consented_at timestamptz,
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_strategy_id,source_strategy_revision_id)
);

create index if not exists marketplace_candidates_status_idx
  on public.marketplace_strategy_candidates(qualification_status,updated_at desc);
create index if not exists marketplace_candidates_owner_idx
  on public.marketplace_strategy_candidates(owner_user_id,updated_at desc);

alter table public.marketplace_qualification_policies enable row level security;
alter table public.marketplace_strategy_candidates enable row level security;
revoke all on public.marketplace_qualification_policies,public.marketplace_strategy_candidates from public,anon,authenticated;
grant select on public.marketplace_qualification_policies,public.marketplace_strategy_candidates to service_role;
grant insert,update on public.marketplace_strategy_candidates to service_role;

create or replace function public.evaluate_marketplace_strategy_candidate(
  p_source_strategy_id uuid,
  p_source_strategy_revision_id text
) returns public.marketplace_strategy_candidates
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_profile public.strategy_profiles%rowtype;
  v_policy public.marketplace_qualification_policies%rowtype;
  v_first_activity timestamptz;
  v_last_activity timestamptz;
  v_backtests integer:=0;
  v_decisions integer:=0;
  v_trades integer:=0;
  v_violations integer:=0;
  v_adherence numeric;
  v_drawdown numeric;
  v_candidate public.marketplace_strategy_candidates%rowtype;
  v_status text;
begin
  if p_source_strategy_id is null or nullif(btrim(p_source_strategy_revision_id),'') is null then
    raise exception 'Strategy and exact revision are required';
  end if;
  select * into v_profile from public.strategy_profiles where id=p_source_strategy_id and is_archived=false;
  if not found then raise exception 'Active strategy profile not found'; end if;
  select * into v_policy from public.marketplace_qualification_policies where active=true limit 1;
  if not found then raise exception 'Active Marketplace qualification policy not found'; end if;

  select count(*)::integer into v_backtests from public.backtest_runs
   where strategy_profile_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id and status='COMPLETED';
  select count(*)::integer into v_decisions from public.decision_reports
   where strategy_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id;
  select count(*)::integer,
         count(*) filter(where coalesce(taken_against_verdict,false)=true)::integer,
         case when count(*)>0 then round(100.0*count(*) filter(where coalesce(taken_against_verdict,false)=false)/count(*),2) else null end
    into v_trades,v_violations,v_adherence
    from public.active_trades
   where strategy_profile_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id
     and status='CLOSED' and closed_at is not null and result_r is not null;

  with ordered as (
    select coalesce(closed_at,created_at) at,result_r,
           sum(result_r) over(order by coalesce(closed_at,created_at),id) equity
      from public.active_trades
     where strategy_profile_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id
       and status='CLOSED' and closed_at is not null and result_r is not null
  ), peaks as (
    select equity,max(equity) over(order by at) peak from ordered
  ) select coalesce(max(peak-equity),0) into v_drawdown from peaks;

  select min(at),max(at) into v_first_activity,v_last_activity from (
    select created_at at from public.backtest_runs where strategy_profile_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id and status='COMPLETED'
    union all select created_at from public.decision_reports where strategy_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id
    union all select closed_at from public.active_trades where strategy_profile_id=p_source_strategy_id and strategy_revision_id=p_source_strategy_revision_id and status='CLOSED' and closed_at is not null
  ) activity;

  insert into public.marketplace_strategy_candidates(
    source_strategy_id,owner_user_id,source_strategy_revision_id,qualification_policy_version,
    observation_started_at,last_verified_activity_at,completed_backtests,saved_decisions,closed_trades,
    adherence_percent,critical_violations,maximum_drawdown_r
  ) values (
    p_source_strategy_id,v_profile.user_id,p_source_strategy_revision_id,v_policy.version,
    coalesce(v_first_activity,now()),v_last_activity,v_backtests,v_decisions,v_trades,
    v_adherence,v_violations,v_drawdown
  ) on conflict(source_strategy_id,source_strategy_revision_id) do update set
    qualification_policy_version=excluded.qualification_policy_version,
    observation_started_at=least(public.marketplace_strategy_candidates.observation_started_at,excluded.observation_started_at),
    last_verified_activity_at=excluded.last_verified_activity_at,
    completed_backtests=excluded.completed_backtests,saved_decisions=excluded.saved_decisions,
    closed_trades=excluded.closed_trades,adherence_percent=excluded.adherence_percent,
    critical_violations=excluded.critical_violations,maximum_drawdown_r=excluded.maximum_drawdown_r,
    updated_at=now()
  returning * into v_candidate;

  v_candidate.observation_days:=floor(extract(epoch from (now()-v_candidate.observation_started_at))/86400)::integer;
  if v_candidate.qualification_status='ARCHIVED' then
    v_status:='ARCHIVED';
  elsif v_candidate.observation_days<v_policy.minimum_observation_days or v_trades<v_policy.minimum_closed_trades then
    v_status:=case when v_trades=0 and v_decisions=0 and v_backtests=0 then 'OBSERVING' else 'INSUFFICIENT_DATA' end;
  elsif coalesce(v_adherence,0)<v_policy.minimum_adherence_percent or v_violations>v_policy.maximum_critical_violations or coalesce(v_drawdown,0)>v_policy.maximum_drawdown_r then
    v_status:='INSUFFICIENT_DATA';
  elsif v_candidate.qualification_status='APPROVED' and v_candidate.owner_consent_status='GRANTED' then v_status:='APPROVED';
  elsif v_candidate.qualification_status='DECLINED' then v_status:='DECLINED';
  elsif v_candidate.owner_consent_status in ('DECLINED','REVOKED') then v_status:='DECLINED';
  elsif v_candidate.owner_consent_status='GRANTED' then v_status:='UNDER_REVIEW';
  else v_status:='OWNER_CONSENT_PENDING';
  end if;
  update public.marketplace_strategy_candidates set
    observation_days=v_candidate.observation_days,
    qualification_status=v_status,
    owner_consent_status=case when v_status='OWNER_CONSENT_PENDING' and owner_consent_status='NOT_REQUESTED' then 'PENDING' else owner_consent_status end,
    qualified_at=case when v_status in ('OWNER_CONSENT_PENDING','UNDER_REVIEW') then coalesce(qualified_at,now()) else qualified_at end,
    updated_at=now()
   where id=v_candidate.id returning * into v_candidate;
  return v_candidate;
end;
$$;

revoke all on function public.evaluate_marketplace_strategy_candidate(uuid,text) from public,anon,authenticated;
grant execute on function public.evaluate_marketplace_strategy_candidate(uuid,text) to service_role;

create or replace function public.set_marketplace_strategy_owner_consent(
  p_candidate_id uuid,p_granted boolean,p_terms_version text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c public.marketplace_strategy_candidates%rowtype;
  p public.marketplace_qualification_policies%rowtype;
  strategy public.strategy_profiles%rowtype;
  licensed_strategy jsonb;
  sanitized jsonb;
  snapshot jsonb;
  v_release_id uuid;
  v_listing_id uuid;
  next_release_version integer;
  rule_total integer:=0;
  rule_required integer:=0;
  rule_automatic integer:=0;
  rule_manual integer:=0;
  rule_external integer:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into c from public.marketplace_strategy_candidates where id=p_candidate_id for update;
  if not found or c.owner_user_id<>auth.uid() then raise exception 'Marketplace candidate not found'; end if;
  if p_granted and c.qualification_status not in ('OWNER_CONSENT_PENDING','QUALIFIED') then raise exception 'Strategy has not reached the qualification threshold'; end if;
  if p_granted and nullif(btrim(p_terms_version),'') is null then raise exception 'Consent terms version is required'; end if;
  if p_granted then
    select * into p from public.marketplace_qualification_policies where version=c.qualification_policy_version;
    select * into strategy from public.strategy_profiles where id=c.source_strategy_id and user_id=auth.uid() and is_archived=false for update;
    if not found then raise exception 'Active strategy profile not found'; end if;
    select count(*)::integer,
           count(*) filter(where mandatory)::integer,
           count(*) filter(where coalesce(evaluation_mode,'AUTOMATIC')='AUTOMATIC')::integer,
           count(*) filter(where evaluation_mode='MANUAL')::integer,
           count(*) filter(where evaluation_mode='EXTERNAL')::integer
      into rule_total,rule_required,rule_automatic,rule_manual,rule_external
      from public.strategy_rules where strategy_id=strategy.id and enabled=true;
    licensed_strategy:=public.marketplace_normalize_strategy_profile_for_revision(strategy.id);
    sanitized:=jsonb_build_object(
      'strategyName',coalesce(nullif(strategy.name,''),'Qualified strategy'),
      'creatorName',coalesce((select nullif(display_name,'') from public.profiles where id=auth.uid()),'Private creator'),
      'category',coalesce(strategy.market_types[1],'OTHER'),
      'instruments',coalesce(licensed_strategy->'instruments','[]'::jsonb),
      'macroTimeframe',strategy.macro_timeframe,'executionTimeframe',strategy.entry_timeframe,
      'compatibility','NEEDS_REVIEW','sourceType','CUSTOMER_BETA','eligibilityStatus','UNDER_REVIEW',
      'internalTest',false,'commerceEnabled',false,
      'ruleCounts',jsonb_build_object('total',rule_total,'required',rule_required,'optional',greatest(rule_total-rule_required,0),'automatic',rule_automatic,'manual',rule_manual,'external',rule_external)
    );
    select id into v_release_id from public.marketplace_strategy_releases
      where source_strategy_id=c.source_strategy_id and source_strategy_revision_id=c.source_strategy_revision_id;
    if v_release_id is null then
      select coalesce(max(release_version),0)+1 into next_release_version from public.marketplace_strategy_releases where source_strategy_id=c.source_strategy_id;
      snapshot:=jsonb_build_object(
        'source',jsonb_build_object('kind','CUSTOMER_BETA','strategyProfileId',c.source_strategy_id,'strategyRevisionId',c.source_strategy_revision_id,'ownerUserId',auth.uid()),
        'licensedStrategy',licensed_strategy,'sanitizedMetadata',sanitized,
        'ownerConsent',jsonb_build_object('termsVersion',p_terms_version,'consentedAt',now())
      );
      insert into public.marketplace_strategy_releases(
        creator_user_id,source_strategy_id,source_strategy_revision_id,release_version,snapshot_fingerprint,snapshot_json,
        source_type,minimum_observation_days,eligibility_status,ip_owner_user_id,observation_started_at,owner_consent_at,owner_consent_version
      ) values (
        auth.uid(),c.source_strategy_id,c.source_strategy_revision_id,next_release_version,
        encode(extensions.digest(snapshot::text,'sha256'),'hex'),snapshot,'CUSTOMER_BETA',p.minimum_observation_days,
        'UNDER_REVIEW',auth.uid(),c.observation_started_at,now(),p_terms_version
      ) returning id into v_release_id;
      insert into public.marketplace_listings(release_id,visibility,review_status,sanitized_metadata,display_price_cents,creator_share_cents,platform_share_cents,commerce_enabled)
      values(v_release_id,'INTERNAL','IN_REVIEW',sanitized,3000,1500,1500,false) returning id into v_listing_id;
      insert into public.marketplace_review_events(release_id,actor_user_id,actor_scope,event_type,note)
      values(v_release_id,auth.uid(),'SYSTEM','OWNER_CONSENT_SUBMITTED','Qualified exact revision submitted for internal Compliance review. Public visibility and commerce remain disabled.');
    else
      select id into v_listing_id from public.marketplace_listings where release_id=v_release_id;
    end if;
  end if;
  update public.marketplace_strategy_candidates set
    owner_consent_status=case when p_granted then 'GRANTED' else 'DECLINED' end,
    owner_consent_version=case when p_granted then p_terms_version else null end,
    owner_consented_at=case when p_granted then now() else null end,
    qualification_status=case when p_granted then 'UNDER_REVIEW' else 'DECLINED' end,
    updated_at=now()
  where id=c.id returning * into c;
  return jsonb_build_object('candidateId',c.id,'consentStatus',c.owner_consent_status,'status',c.qualification_status,'termsVersion',c.owner_consent_version,'releaseId',v_release_id,'listingId',v_listing_id);
end;$$;
revoke all on function public.set_marketplace_strategy_owner_consent(uuid,boolean,text) from public,anon;
grant execute on function public.set_marketplace_strategy_owner_consent(uuid,boolean,text) to authenticated;

create or replace function public.marketplace_attach_licensed_strategy_snapshot()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  new.snapshot_json:=new.snapshot_json||jsonb_build_object('licensedStrategy',public.marketplace_normalize_strategy_profile_for_revision(new.source_strategy_id));
  return new;
end;$$;
drop trigger if exists marketplace_attach_licensed_strategy_snapshot on public.marketplace_strategy_releases;
create trigger marketplace_attach_licensed_strategy_snapshot before insert on public.marketplace_strategy_releases
for each row execute function public.marketplace_attach_licensed_strategy_snapshot();

-- Repair legacy internal releases once, with an explicit append-only audit event.
alter table public.marketplace_strategy_releases disable trigger marketplace_release_immutable_update;
update public.marketplace_strategy_releases r set
  snapshot_json=r.snapshot_json||jsonb_build_object('licensedStrategy',public.marketplace_normalize_strategy_profile_for_revision(r.source_strategy_id)),
  snapshot_fingerprint=encode(extensions.digest((r.snapshot_json||jsonb_build_object('licensedStrategy',public.marketplace_normalize_strategy_profile_for_revision(r.source_strategy_id)))::text,'sha256'),'hex')
where r.source_type='INTERNAL_TRADE_POLICE' and not (r.snapshot_json?'licensedStrategy');
alter table public.marketplace_strategy_releases enable trigger marketplace_release_immutable_update;
insert into public.marketplace_review_events(release_id,actor_scope,event_type,note)
select r.id,'SYSTEM','LICENSE_SNAPSHOT_REPAIRED','One-time migration repair: attached the exact normalized strategy revision for internal simulated licensing.'
from public.marketplace_strategy_releases r
where r.source_type='INTERNAL_TRADE_POLICE' and r.snapshot_json?'licensedStrategy'
  and not exists(select 1 from public.marketplace_review_events e where e.release_id=r.id and e.event_type='LICENSE_SNAPSHOT_REPAIRED');

grant select,update on public.marketplace_listings to service_role;
grant select,insert on public.marketplace_review_events to service_role;
grant select on public.marketplace_installs,public.marketplace_strategy_releases,public.marketplace_release_rankings to service_role;

-- Review state and its audit event commit together; callers cannot leave a half-reviewed listing.
create or replace function public.staff_marketplace_transition_listing(
  p_listing_id uuid,p_review_status text,p_note text,p_actor_user_id uuid
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  l public.marketplace_listings%rowtype;
  allowed text[];
begin
  select * into l from public.marketplace_listings where id=p_listing_id for update;
  if not found then raise exception 'Marketplace listing not found'; end if;
  allowed:=case l.review_status
    when 'DRAFT' then array['IN_REVIEW','ARCHIVED']
    when 'IN_REVIEW' then array['APPROVED','REJECTED']
    when 'APPROVED' then array['ARCHIVED']
    when 'REJECTED' then array['IN_REVIEW','ARCHIVED']
    else array[]::text[] end;
  if not (p_review_status=any(allowed)) then
    raise exception 'Marketplace review transition from % to % is not allowed',l.review_status,p_review_status;
  end if;
  if p_review_status in ('APPROVED','REJECTED') and nullif(btrim(p_note),'') is null then
    raise exception 'A review note is required';
  end if;
  update public.marketplace_listings set review_status=p_review_status,updated_at=now() where id=l.id;
  update public.marketplace_strategy_candidates candidate set
    qualification_status=case p_review_status when 'APPROVED' then 'APPROVED' when 'REJECTED' then 'DECLINED' when 'ARCHIVED' then 'ARCHIVED' else 'UNDER_REVIEW' end,
    updated_at=now()
  from public.marketplace_strategy_releases release
  where release.id=l.release_id and release.source_type='CUSTOMER_BETA'
    and candidate.source_strategy_id=release.source_strategy_id
    and candidate.source_strategy_revision_id=release.source_strategy_revision_id;
  insert into public.marketplace_review_events(release_id,actor_user_id,actor_scope,event_type,note)
  values(l.release_id,p_actor_user_id,'COMPLIANCE','REVIEW_'||p_review_status,nullif(btrim(p_note),''));
  return jsonb_build_object('listingId',l.id,'releaseId',l.release_id,'previousStatus',l.review_status,'reviewStatus',p_review_status);
end;$$;
revoke all on function public.staff_marketplace_transition_listing(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.staff_marketplace_transition_listing(uuid,text,text,uuid) to service_role;

create or replace function public.staff_marketplace_simulate_install(p_listing_id uuid,p_recipient_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  l public.marketplace_listings%rowtype;
  r public.marketplace_strategy_releases%rowtype;
  i public.marketplace_installs%rowtype;
  s jsonb;
  new_strategy uuid;
begin
  if not public.has_marketplace_lab_access() then raise exception 'Marketplace Lab permission denied'; end if;
  select * into l from public.marketplace_listings where id=p_listing_id and visibility='INTERNAL' and review_status='APPROVED' for update;
  if not found then raise exception 'Internal approved listing not found'; end if;
  if not exists(select 1 from auth.users where id=p_recipient_user_id) then raise exception 'Recipient not found'; end if;
  select * into r from public.marketplace_strategy_releases where id=l.release_id and source_type='INTERNAL_TRADE_POLICE' and eligibility_status='ELIGIBILITY_WAIVED';
  if not found then raise exception 'Only INTERNAL TEST releases may use simulated installs'; end if;
  s:=r.snapshot_json->'licensedStrategy';
  if s is null or jsonb_typeof(s)<>'object' then raise exception 'Licensed strategy snapshot is unavailable'; end if;
  if exists(select 1 from public.marketplace_installs where release_id=r.id and installer_user_id=p_recipient_user_id) then raise exception 'Release already installed for this recipient'; end if;

  insert into public.marketplace_installs(release_id,installer_user_id,entitlement_mode,charged_cents,status)
  values(r.id,p_recipient_user_id,'SIMULATED_INTERNAL',0,'INSTALLED') returning * into i;
  insert into public.strategy_profiles(
    user_id,name,is_default,market_types,instruments,trend_timeframe,confirmation_timeframe,entry_timeframe,
    macro_timeframe,trigger_timeframe,minimum_rr,maximum_risk_percent,maximum_trades_per_day,
    allowed_sessions,evidence_weights,required_evidence,stop_limits,authorization_score,wait_score,
    loss_streak_limit,marketplace_source_release_id,marketplace_install_id
  ) values (
    p_recipient_user_id,coalesce(nullif(s->>'name',''),'Installed strategy'),false,
    coalesce(array(select jsonb_array_elements_text(s->'marketTypes')),array[]::text[]),
    coalesce(array(select jsonb_array_elements_text(s->'instruments')),array[]::text[]),
    coalesce(s->>'trendTimeframe',''),coalesce(s->>'confirmationTimeframe',''),coalesce(s->>'entryTimeframe',''),
    nullif(s->>'macroTimeframe',''),nullif(s->>'triggerTimeframe',''),coalesce((s->>'minimumRR')::numeric,0),
    coalesce((s->>'maximumRiskPercent')::numeric,0),coalesce((s->>'maximumTradesPerDay')::integer,2),
    coalesce(array(select jsonb_array_elements_text(s->'allowedSessions')),array[]::text[]),
    coalesce(s->'evidenceWeights','{}'::jsonb),coalesce(array(select jsonb_array_elements_text(s->'requiredEvidence')),array[]::text[]),
    coalesce(s->'stopLimits','{}'::jsonb),coalesce((s->>'authorizationScore')::integer,80),coalesce((s->>'waitScore')::integer,70),
    coalesce((s->>'lossStreakLimit')::integer,5),r.id,i.id
  ) returning id into new_strategy;

  insert into public.strategy_instruments(strategy_id,user_id,symbol,market_type,provider_symbol,sort_order,enabled)
  select new_strategy,p_recipient_user_id,instrument.value,coalesce(s->'marketTypes'->>0,'FOREX'),instrument.value,instrument.ordinality::integer,true
  from jsonb_array_elements_text(coalesce(s->'instruments','[]'::jsonb)) with ordinality as instrument(value,ordinality);
  insert into public.strategy_sessions(strategy_id,user_id,session_code,name,timezone,start_time,end_time,days,allow_open_outside,allow_hold_outside,is_custom)
  select new_strategy,p_recipient_user_id,x."sessionCode",x.name,x.timezone,x."startTime"::time,x."endTime"::time,x.days,x."allowOpenOutside",x."allowHoldOutside",x."isCustom"
  from jsonb_to_recordset(coalesce(s->'sessions','[]'::jsonb))
    as x("sessionCode" text,name text,timezone text,"startTime" text,"endTime" text,days smallint[],"allowOpenOutside" boolean,"allowHoldOutside" boolean,"isCustom" boolean);
  insert into public.strategy_rules(strategy_id,user_id,rule_key,label,enabled,mandatory,weight,minimum_confidence,timeframe_role,configuration,sort_order,evaluation_mode)
  select new_strategy,p_recipient_user_id,rule.value->>'ruleKey',rule.value->>'label',coalesce((rule.value->>'enabled')::boolean,true),coalesce((rule.value->>'mandatory')::boolean,false),coalesce((rule.value->>'weight')::numeric,0),coalesce((rule.value->>'minimumConfidence')::integer,0),rule.value->>'timeframeRole','{}'::jsonb,rule.ordinality::integer,coalesce(rule.value->>'evaluationMode','AUTOMATIC')
  from jsonb_array_elements(coalesce(s->'rules','[]'::jsonb)) with ordinality as rule(value,ordinality);
  insert into public.strategy_stop_limits(strategy_id,user_id,instrument,method,minimum_value,preferred_value,maximum_value,atr_multiplier,configuration)
  select new_strategy,p_recipient_user_id,x.instrument,x.method,x."minimumValue",x."preferredValue",x."maximumValue",x."atrMultiplier",'{}'::jsonb
  from jsonb_to_recordset(coalesce(s->'stopLimitSettings','[]'::jsonb))
    as x(instrument text,method text,"minimumValue" numeric,"preferredValue" numeric,"maximumValue" numeric,"atrMultiplier" numeric);
  update public.marketplace_installs set installed_strategy_id=new_strategy where id=i.id;
  insert into public.marketplace_review_events(release_id,actor_user_id,actor_scope,event_type,note)
  values(r.id,auth.uid(),'SYSTEM','SIMULATED_INSTALL','Inactive internal license installed from immutable strategy revision.');
  return jsonb_build_object('installId',i.id,'releaseId',r.id,'installedStrategyId',new_strategy,'chargedCents',0,'entitlementMode','SIMULATED_INTERNAL','active',false,'internalTest',true);
end;$$;
revoke all on function public.staff_marketplace_simulate_install(uuid,uuid) from public,anon;
grant execute on function public.staff_marketplace_simulate_install(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
