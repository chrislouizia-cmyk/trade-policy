-- Private-beta retention, sanitized report incidents, schema audits and aggregate lifecycle events.
create table if not exists public.decision_report_operational_failures(
  id bigint generated always as identity primary key,
  reason_code text not null check(reason_code in('AUTHENTICATION_FAILED','SOURCE_EXPIRED','SOURCE_NOT_FOUND','STRATEGY_REVISION_MISMATCH','FINGERPRINT_FAILURE','DATABASE_UNAVAILABLE','IDEMPOTENCY_CONFLICT','UNKNOWN_SAFE_ERROR')),
  request_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  source_analysis_id uuid references public.market_scans(id) on delete set null,
  retryable boolean not null,
  occurred_at timestamptz not null default now()
);
create index if not exists decision_report_failures_time_idx on public.decision_report_operational_failures(occurred_at desc,reason_code);
alter table public.decision_report_operational_failures enable row level security;
revoke all on public.decision_report_operational_failures from public,anon,authenticated;

create table if not exists public.decision_source_cleanup_runs(
  id bigint generated always as identity primary key,
  dry_run boolean not null,
  expired_count bigint not null,
  deleted_count bigint not null,
  ran_at timestamptz not null default now()
);
alter table public.decision_source_cleanup_runs enable row level security;
revoke all on public.decision_source_cleanup_runs from public,anon,authenticated;

create or replace function public.cleanup_expired_decision_report_sources(p_dry_run boolean default true)
returns table(expired_count bigint,deleted_count bigint)
language plpgsql security definer set search_path=public as $$
declare v_expired bigint;v_deleted bigint:=0;
begin
  select count(*) into v_expired from public.decision_report_sources where expires_at<=now();
  if not p_dry_run then
    delete from public.decision_report_sources where expires_at<=now();
    get diagnostics v_deleted=row_count;
  end if;
  insert into public.decision_source_cleanup_runs(dry_run,expired_count,deleted_count) values(p_dry_run,v_expired,v_deleted);
  return query select v_expired,v_deleted;
end;$$;
revoke all on function public.cleanup_expired_decision_report_sources(boolean) from public,anon,authenticated;
grant execute on function public.cleanup_expired_decision_report_sources(boolean) to service_role;

create or replace function public.record_decision_report_failure(p_reason_code text,p_request_id uuid,p_user_id uuid,p_source_analysis_id uuid,p_retryable boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_reason_code not in('AUTHENTICATION_FAILED','SOURCE_EXPIRED','SOURCE_NOT_FOUND','STRATEGY_REVISION_MISMATCH','FINGERPRINT_FAILURE','DATABASE_UNAVAILABLE','IDEMPOTENCY_CONFLICT','UNKNOWN_SAFE_ERROR') then raise exception 'Unsupported report failure code';end if;
  insert into public.decision_report_operational_failures(reason_code,request_id,user_id,source_analysis_id,retryable)
  values(p_reason_code,p_request_id,p_user_id,p_source_analysis_id,p_retryable);
end;$$;
revoke all on function public.record_decision_report_failure(text,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.record_decision_report_failure(text,uuid,uuid,uuid,boolean) to service_role;

create or replace function public.private_beta_report_operations_summary()
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object(
    'expiredSourceBacklog',(select count(*) from public.decision_report_sources where expires_at<=now()),
    'reportCount',(select count(*) from public.decision_reports),
    'recentFailureCount',(select count(*) from public.decision_report_operational_failures where occurred_at>=now()-interval '24 hours'),
    'recentFailures',coalesce((select jsonb_object_agg(reason_code,n) from (select reason_code,count(*) n from public.decision_report_operational_failures where occurred_at>=now()-interval '24 hours' group by reason_code)x),'{}'::jsonb),
    'schemaVersions',coalesce((select jsonb_object_agg(schema_version,n) from (select schema_version,count(*) n from public.decision_reports group by schema_version)x),'{}'::jsonb)
  )
$$;
revoke all on function public.private_beta_report_operations_summary() from public,anon,authenticated;
grant execute on function public.private_beta_report_operations_summary() to service_role;

-- Reused idempotency keys may only resolve the same authoritative decision.
create or replace function public.save_decision_report(p_source_id uuid,p_user_id uuid,p_idempotency_key text)
returns table(report_id uuid,created_at timestamptz,duplicate boolean)
language plpgsql security definer set search_path=public as $$
declare s public.decision_report_sources%rowtype;existing public.decision_reports%rowtype;
begin
  if nullif(trim(p_idempotency_key),'') is null or char_length(p_idempotency_key)>100 then raise exception 'invalid idempotency key';end if;
  select * into s from public.decision_report_sources where id=p_source_id and user_id=p_user_id and expires_at>now() for update;
  if not found then raise exception 'decision source unavailable';end if;
  select * into existing from public.decision_reports where user_id=p_user_id and idempotency_key=p_idempotency_key limit 1;
  if found then
    if existing.source_analysis_id<>s.source_analysis_id or existing.deterministic_fingerprint<>s.deterministic_fingerprint then raise exception using errcode='TP409',message='idempotency conflict';end if;
    return query select existing.id,existing.created_at,true;return;
  end if;
  select * into existing from public.decision_reports where user_id=p_user_id and source_analysis_id=s.source_analysis_id and deterministic_fingerprint=s.deterministic_fingerprint limit 1;
  if found then return query select existing.id,existing.created_at,true;return;end if;
  insert into public.decision_reports(id,user_id,schema_version,verdict,readiness_percent,instrument,timeframe,strategy_id,strategy_name,strategy_revision_id,strategy_version,primary_reason,next_action,market_provider,last_verified_candle_at,data_freshness,deterministic_fingerprint,snapshot_json,source_analysis_id,idempotency_key,created_at)
  values((s.snapshot_json->>'reportId')::uuid,p_user_id,s.schema_version,s.snapshot_json->>'verdict',nullif(s.snapshot_json->>'readinessPercent','')::numeric,s.snapshot_json->>'instrument',s.snapshot_json->>'timeframe',s.strategy_id,s.snapshot_json->>'strategyName',s.snapshot_json->>'strategyRevisionId',s.snapshot_json->>'strategyVersion',s.snapshot_json->>'primaryReason',s.snapshot_json->>'nextAction',s.snapshot_json#>>'{marketData,provider}',nullif(s.snapshot_json#>>'{marketData,lastVerifiedCandleAt}','')::timestamptz,s.snapshot_json#>>'{marketData,freshness}',s.deterministic_fingerprint,s.snapshot_json,s.source_analysis_id,p_idempotency_key,now()) returning * into existing;
  if s.ai_explanation_json is not null then insert into public.decision_report_ai_explanations(report_id,user_id,explanation_version,provider,model,prose,source_verdict,source_deterministic_fingerprint,authoritative,created_at) values(existing.id,p_user_id,s.ai_explanation_json->>'explanationVersion',s.ai_explanation_json->>'provider',s.ai_explanation_json->>'model',s.ai_explanation_json->>'prose',s.ai_explanation_json->>'sourceVerdict',s.ai_explanation_json->>'sourceDeterministicFingerprint',false,(s.ai_explanation_json->>'createdAt')::timestamptz);end if;
  return query select existing.id,existing.created_at,false;
exception when unique_violation then
  select * into existing from public.decision_reports where user_id=p_user_id and idempotency_key=p_idempotency_key limit 1;
  if found then
    if existing.source_analysis_id<>s.source_analysis_id or existing.deterministic_fingerprint<>s.deterministic_fingerprint then raise exception using errcode='TP409',message='idempotency conflict';end if;
    return query select existing.id,existing.created_at,true;return;
  end if;
  select * into existing from public.decision_reports where user_id=p_user_id and source_analysis_id=s.source_analysis_id and deterministic_fingerprint=s.deterministic_fingerprint limit 1;
  if found then return query select existing.id,existing.created_at,true;else raise;end if;
end;$$;
revoke all on function public.save_decision_report(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_decision_report(uuid,uuid,text) to service_role;

alter table public.beta_intelligence_events drop constraint if exists beta_intelligence_events_event_type_check;
alter table public.beta_intelligence_events add constraint beta_intelligence_events_event_type_check check(event_type in(
  'ONBOARDING_STARTED','ONBOARDING_COMPLETED','PLAYBOOK_CREATED','PLAYBOOK_UPDATED','PLAYBOOK_DUPLICATED','PLAYBOOK_ARCHIVED','PLAYBOOK_RESTORED','PLAYBOOK_DELETED','METHODOLOGY_CONFIRMED','METHODOLOGY_REJECTED','SIMULATION_APPROVED','SIMULATION_REJECTED','FIRST_ANALYSIS_STARTED','FIRST_ANALYSIS_COMPLETED','ANALYSIS_COMPLETED','ANALYSIS_ABANDONED',
  'SIGNUP_COMPLETED','STRATEGY_SAVED','DECISION_REPORT_OPENED','DECISION_REPORT_SAVED','SAVED_REPORT_REOPENED','UPGRADE_INITIATED','CHECKOUT_COMPLETED'
));
create unique index if not exists beta_signup_once_idx on public.beta_intelligence_events(user_id,event_type) where event_type='SIGNUP_COMPLETED';

create or replace function public.log_server_beta_event(p_user_id uuid,p_event_type text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_event_type not in('SIGNUP_COMPLETED','DECISION_REPORT_SAVED','SAVED_REPORT_REOPENED','CHECKOUT_COMPLETED') then raise exception 'Unsupported server event';end if;
  if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Unknown user';end if;
  insert into public.beta_intelligence_events(user_id,playbook_id,event_type,app_version,platform,session_id)
  values(p_user_id,null,p_event_type,'1.0.0-beta.21','UNKNOWN',gen_random_uuid())
  on conflict(user_id,event_type) where event_type='SIGNUP_COMPLETED' do nothing;
end;$$;
revoke all on function public.log_server_beta_event(uuid,text) from public,anon,authenticated;
grant execute on function public.log_server_beta_event(uuid,text) to service_role;

create or replace function public.log_beta_intelligence_event(p_event_type text,p_playbook_id uuid,p_app_version text,p_platform text,p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_user_id uuid:=auth.uid();v_now timestamptz:=now();
begin
  if v_user_id is null then raise exception 'Authentication required';end if;
  if p_event_type not in('ONBOARDING_STARTED','ONBOARDING_COMPLETED','PLAYBOOK_CREATED','PLAYBOOK_UPDATED','PLAYBOOK_DUPLICATED','PLAYBOOK_ARCHIVED','PLAYBOOK_RESTORED','PLAYBOOK_DELETED','METHODOLOGY_CONFIRMED','METHODOLOGY_REJECTED','SIMULATION_APPROVED','SIMULATION_REJECTED','ANALYSIS_COMPLETED','ANALYSIS_ABANDONED','STRATEGY_SAVED','DECISION_REPORT_OPENED','UPGRADE_INITIATED') then raise exception 'Unsupported Beta Intelligence event';end if;
  if p_platform not in('DESKTOP','MOBILE','TABLET','UNKNOWN') then raise exception 'Unsupported platform';end if;
  if p_playbook_id is not null and not exists(select 1 from public.strategy_profiles where id=p_playbook_id and user_id=v_user_id) and p_event_type<>'PLAYBOOK_DELETED' then raise exception 'Playbook unavailable';end if;
  insert into public.beta_intelligence_events(user_id,occurred_at,playbook_id,event_type,app_version,platform,session_id) values(v_user_id,v_now,p_playbook_id,p_event_type,left(p_app_version,40),p_platform,p_session_id);
  if p_event_type='ANALYSIS_COMPLETED' then insert into public.beta_intelligence_events(user_id,occurred_at,playbook_id,event_type,app_version,platform,session_id) values(v_user_id,v_now,p_playbook_id,'FIRST_ANALYSIS_COMPLETED',left(p_app_version,40),p_platform,p_session_id) on conflict(user_id,event_type) where event_type in('FIRST_ANALYSIS_STARTED','FIRST_ANALYSIS_COMPLETED') do nothing;end if;
end;$$;
revoke all on function public.log_beta_intelligence_event(text,uuid,text,text,uuid) from public;
grant execute on function public.log_beta_intelligence_event(text,uuid,text,text,uuid) to authenticated;
