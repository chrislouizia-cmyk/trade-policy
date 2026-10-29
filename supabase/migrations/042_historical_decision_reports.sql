-- Immutable, server-authoritative historical Decision Reports.
alter table public.market_scans add column if not exists server_created boolean not null default false;
alter table public.market_scans add column if not exists strategy_revision_id text;
create table if not exists public.decision_report_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_analysis_id uuid not null references public.market_scans(id) on delete cascade,
  strategy_id uuid references public.strategy_profiles(id) on delete set null,
  schema_version text not null check (schema_version = '1.0.0'),
  deterministic_fingerprint text not null check (deterministic_fingerprint ~ '^[a-f0-9]{64}$'),
  snapshot_json jsonb not null,
  ai_explanation_json jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  check (expires_at > created_at)
);

create table if not exists public.decision_reports (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version text not null,
  verdict text not null,
  readiness_percent numeric,
  instrument text not null,
  timeframe text not null,
  strategy_id uuid references public.strategy_profiles(id) on delete set null,
  strategy_name text not null,
  strategy_revision_id text,
  strategy_version text,
  primary_reason text not null,
  next_action text not null,
  market_provider text not null,
  last_verified_candle_at timestamptz,
  data_freshness text not null,
  deterministic_fingerprint text not null check (deterministic_fingerprint ~ '^[a-f0-9]{64}$'),
  snapshot_json jsonb not null,
  source_analysis_id uuid not null references public.market_scans(id) on delete restrict,
  source_trade_id uuid references public.trade_records(id) on delete set null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 100),
  created_at timestamptz not null,
  unique (user_id, source_analysis_id, deterministic_fingerprint),
  unique (user_id, idempotency_key)
);

create table if not exists public.decision_report_ai_explanations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.decision_reports(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  explanation_version text not null,
  provider text,
  model text,
  prose text not null,
  source_verdict text not null,
  source_deterministic_fingerprint text not null,
  authoritative boolean not null default false check (authoritative = false),
  created_at timestamptz not null
);

create index if not exists decision_reports_user_created_idx on public.decision_reports(user_id,created_at desc,id desc);
create index if not exists decision_reports_user_filters_idx on public.decision_reports(user_id,verdict,instrument,strategy_id,created_at desc);
create index if not exists decision_report_sources_expiry_idx on public.decision_report_sources(expires_at);

alter table public.decision_report_sources enable row level security;
alter table public.decision_reports enable row level security;
alter table public.decision_report_ai_explanations enable row level security;

revoke all on public.decision_report_sources from anon, authenticated;
revoke all on public.decision_reports from anon, authenticated;
revoke all on public.decision_report_ai_explanations from anon, authenticated;
grant select on public.decision_reports to authenticated;
grant select on public.decision_report_ai_explanations to authenticated;
create policy "decision reports select own" on public.decision_reports for select to authenticated using ((select auth.uid())=user_id);
create policy "decision report ai select own" on public.decision_report_ai_explanations for select to authenticated using ((select auth.uid())=user_id);

-- Market scans are authoritative inputs. The application server writes with service_role.
revoke insert,delete,update on public.market_scans from authenticated;
drop policy if exists "market scans are private" on public.market_scans;
create policy "market scans select own" on public.market_scans for select to authenticated using ((select auth.uid())=user_id);

create or replace function public.save_decision_report(p_source_id uuid,p_user_id uuid,p_idempotency_key text)
returns table(report_id uuid, created_at timestamptz, duplicate boolean)
language plpgsql security definer set search_path=public as $$
declare s public.decision_report_sources%rowtype; existing public.decision_reports%rowtype;
begin
  if nullif(trim(p_idempotency_key),'') is null or char_length(p_idempotency_key)>100 then raise exception 'invalid idempotency key'; end if;
  select * into s from public.decision_report_sources where id=p_source_id and user_id=p_user_id and expires_at>now() for update;
  if not found then raise exception 'decision source unavailable'; end if;
  select * into existing from public.decision_reports where user_id=p_user_id and (idempotency_key=p_idempotency_key or (source_analysis_id=s.source_analysis_id and deterministic_fingerprint=s.deterministic_fingerprint)) limit 1;
  if found then return query select existing.id,existing.created_at,true; return; end if;
  insert into public.decision_reports(id,user_id,schema_version,verdict,readiness_percent,instrument,timeframe,strategy_id,strategy_name,strategy_revision_id,strategy_version,primary_reason,next_action,market_provider,last_verified_candle_at,data_freshness,deterministic_fingerprint,snapshot_json,source_analysis_id,idempotency_key,created_at)
  values ((s.snapshot_json->>'reportId')::uuid,p_user_id,s.schema_version,s.snapshot_json->>'verdict',nullif(s.snapshot_json->>'readinessPercent','')::numeric,s.snapshot_json->>'instrument',s.snapshot_json->>'timeframe',s.strategy_id,s.snapshot_json->>'strategyName',s.snapshot_json->>'strategyRevisionId',s.snapshot_json->>'strategyVersion',s.snapshot_json->>'primaryReason',s.snapshot_json->>'nextAction',s.snapshot_json#>>'{marketData,provider}',nullif(s.snapshot_json#>>'{marketData,lastVerifiedCandleAt}','')::timestamptz,s.snapshot_json#>>'{marketData,freshness}',s.deterministic_fingerprint,s.snapshot_json,s.source_analysis_id,p_idempotency_key,now())
  returning * into existing;
  if s.ai_explanation_json is not null then
    insert into public.decision_report_ai_explanations(report_id,user_id,explanation_version,provider,model,prose,source_verdict,source_deterministic_fingerprint,authoritative,created_at)
    values(existing.id,p_user_id,s.ai_explanation_json->>'explanationVersion',s.ai_explanation_json->>'provider',s.ai_explanation_json->>'model',s.ai_explanation_json->>'prose',s.ai_explanation_json->>'sourceVerdict',s.ai_explanation_json->>'sourceDeterministicFingerprint',false,(s.ai_explanation_json->>'createdAt')::timestamptz);
  end if;
  return query select existing.id,existing.created_at,false;
exception when unique_violation then
  select * into existing from public.decision_reports where user_id=p_user_id and (idempotency_key=p_idempotency_key or (source_analysis_id=s.source_analysis_id and deterministic_fingerprint=s.deterministic_fingerprint)) limit 1;
  if found then return query select existing.id,existing.created_at,true; else raise; end if;
end;$$;
revoke all on function public.save_decision_report(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_decision_report(uuid,uuid,text) to service_role;

create or replace function public.reject_historical_report_mutation() returns trigger language plpgsql as $$begin raise exception 'historical decision reports are immutable';end;$$;
create trigger decision_reports_immutable before update on public.decision_reports for each row execute function public.reject_historical_report_mutation();
create trigger decision_report_ai_immutable before update on public.decision_report_ai_explanations for each row execute function public.reject_historical_report_mutation();
