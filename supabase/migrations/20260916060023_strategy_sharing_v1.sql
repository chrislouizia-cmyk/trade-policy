-- Private strategy sharing v1.
-- A share is a stable invitation; every published version is immutable.
-- Installing always creates (or explicitly updates) a private, inactive copy.

create table public.strategy_shares (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_strategy_id uuid references public.strategy_profiles(id) on delete set null,
  share_code uuid not null default gen_random_uuid() unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
  current_version integer not null default 0 check (current_version >= 0),
  license_code text not null default 'PERSONAL_USE_V1' check (license_code = 'PERSONAL_USE_V1'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (owner_user_id, source_strategy_id)
);

create table public.strategy_share_versions (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.strategy_shares(id) on delete cascade,
  version integer not null check (version > 0),
  source_updated_at timestamptz not null,
  snapshot_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (share_id, version)
);

create table public.strategy_share_installs (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.strategy_shares(id) on delete restrict,
  installer_user_id uuid not null references auth.users(id) on delete cascade,
  installed_strategy_id uuid references public.strategy_profiles(id) on delete set null,
  installed_version integer not null check (installed_version > 0),
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (share_id, installer_user_id)
);

create index strategy_shares_owner_idx on public.strategy_shares(owner_user_id, updated_at desc);
create index strategy_share_versions_share_idx on public.strategy_share_versions(share_id, version desc);
create index strategy_share_installs_share_idx on public.strategy_share_installs(share_id, installed_at desc);
create index strategy_share_installs_user_idx on public.strategy_share_installs(installer_user_id, updated_at desc);

alter table public.strategy_shares enable row level security;
alter table public.strategy_shares force row level security;
alter table public.strategy_share_versions enable row level security;
alter table public.strategy_share_versions force row level security;
alter table public.strategy_share_installs enable row level security;
alter table public.strategy_share_installs force row level security;

revoke all on table public.strategy_shares, public.strategy_share_versions, public.strategy_share_installs
from public, anon, authenticated;

grant select on table public.strategy_shares, public.strategy_share_versions, public.strategy_share_installs
to authenticated;

create policy "strategy shares select own"
on public.strategy_shares for select to authenticated
using ((select auth.uid()) = owner_user_id);

create policy "strategy share versions select own"
on public.strategy_share_versions for select to authenticated
using (exists (
  select 1 from public.strategy_shares share
  where share.id = strategy_share_versions.share_id
    and share.owner_user_id = (select auth.uid())
));

create policy "strategy share installs select participant"
on public.strategy_share_installs for select to authenticated
using (
  installer_user_id = (select auth.uid())
  or exists (
    select 1 from public.strategy_shares share
    where share.id = strategy_share_installs.share_id
      and share.owner_user_id = (select auth.uid())
  )
);

create or replace function public.reject_strategy_share_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Shared strategy versions are immutable';
end;
$$;

create trigger strategy_share_versions_immutable_update
before update on public.strategy_share_versions
for each row execute function public.reject_strategy_share_version_mutation();

create trigger strategy_share_versions_immutable_delete
before delete on public.strategy_share_versions
for each row execute function public.reject_strategy_share_version_mutation();

create or replace function public.publish_strategy_share_v1(p_strategy_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_strategy public.strategy_profiles%rowtype;
  v_share public.strategy_shares%rowtype;
  v_snapshot jsonb;
  v_latest public.strategy_share_versions%rowtype;
  v_version integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select * into v_strategy
  from public.strategy_profiles
  where id = p_strategy_id and user_id = v_user_id and is_archived = false
  for update;
  if not found then raise exception 'Strategy not found or unavailable'; end if;

  select * into v_share
  from public.strategy_shares
  where owner_user_id = v_user_id and source_strategy_id = p_strategy_id
  for update;

  if not found then
    insert into public.strategy_shares(owner_user_id, source_strategy_id)
    values(v_user_id, p_strategy_id)
    returning * into v_share;
  end if;

  select * into v_latest
  from public.strategy_share_versions
  where share_id = v_share.id
  order by version desc
  limit 1;

  if v_latest.id is null or v_latest.source_updated_at is distinct from v_strategy.updated_at then
    v_snapshot := public.marketplace_normalize_strategy_profile_for_revision(p_strategy_id);
    v_version := coalesce(v_latest.version, 0) + 1;
    insert into public.strategy_share_versions(share_id, version, source_updated_at, snapshot_json)
    values(v_share.id, v_version, v_strategy.updated_at, v_snapshot);
  else
    v_version := v_latest.version;
  end if;

  update public.strategy_shares
  set status = 'ACTIVE', current_version = v_version, updated_at = now(), revoked_at = null
  where id = v_share.id
  returning * into v_share;

  return jsonb_build_object(
    'shareId', v_share.id,
    'shareCode', v_share.share_code,
    'status', v_share.status,
    'currentVersion', v_share.current_version,
    'installCount', (select count(*) from public.strategy_share_installs where share_id = v_share.id)
  );
end;
$$;

create or replace function public.revoke_strategy_share_v1(p_share_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_share public.strategy_shares%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  update public.strategy_shares
  set status = 'REVOKED', revoked_at = now(), updated_at = now()
  where id = p_share_id and owner_user_id = v_user_id
  returning * into v_share;
  if not found then raise exception 'Share not found'; end if;
  return jsonb_build_object('shareId', v_share.id, 'status', v_share.status);
end;
$$;

create or replace function public.resolve_strategy_share_v1(p_share_code uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_share public.strategy_shares%rowtype;
  v_version public.strategy_share_versions%rowtype;
  v_install public.strategy_share_installs%rowtype;
  v_creator_name text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_share from public.strategy_shares where share_code = p_share_code and status = 'ACTIVE';
  if not found then raise exception 'This share link is unavailable or has been revoked'; end if;
  select * into v_version from public.strategy_share_versions
    where share_id = v_share.id and version = v_share.current_version;
  if not found then raise exception 'Shared strategy version unavailable'; end if;
  select * into v_install from public.strategy_share_installs
    where share_id = v_share.id and installer_user_id = v_user_id;
  select coalesce(nullif(trim(display_name), ''), 'Trade Police member') into v_creator_name
    from public.profiles where id = v_share.owner_user_id;

  return jsonb_build_object(
    'shareId', v_share.id,
    'shareCode', v_share.share_code,
    'creatorName', coalesce(v_creator_name, 'Trade Police member'),
    'isOwner', v_share.owner_user_id = v_user_id,
    'currentVersion', v_share.current_version,
    'installedVersion', v_install.installed_version,
    'installedStrategyId', v_install.installed_strategy_id,
    'alreadyInstalled', v_install.id is not null and v_install.installed_strategy_id is not null,
    'updateAvailable', v_install.id is not null and v_install.installed_version < v_share.current_version,
    'licenseCode', v_share.license_code,
    'strategy', jsonb_build_object(
      'name', v_version.snapshot_json->>'name',
      'description', coalesce(v_version.snapshot_json->>'description', ''),
      'instruments', coalesce(v_version.snapshot_json->'instruments', '[]'::jsonb),
      'timeframes', jsonb_build_array(
        v_version.snapshot_json->>'macroTimeframe',
        v_version.snapshot_json->>'trendTimeframe',
        v_version.snapshot_json->>'confirmationTimeframe',
        v_version.snapshot_json->>'entryTimeframe',
        v_version.snapshot_json->>'triggerTimeframe'
      ),
      'maximumRiskPercent', v_version.snapshot_json->'maximumRiskPercent',
      'minimumRR', v_version.snapshot_json->'minimumRR',
      'ruleCount', jsonb_array_length(coalesce(v_version.snapshot_json->'rules', '[]'::jsonb)),
      'sessionCount', jsonb_array_length(coalesce(v_version.snapshot_json->'sessions', '[]'::jsonb))
    )
  );
end;
$$;

create or replace function public.install_strategy_share_v1(p_share_code uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_share public.strategy_shares%rowtype;
  v_version public.strategy_share_versions%rowtype;
  v_install public.strategy_share_installs%rowtype;
  v_snapshot jsonb;
  v_strategy_id uuid;
  v_created boolean := false;
  v_name text;
  v_plan text;
  v_strategy_limit integer;
  v_active_strategy_count integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_share from public.strategy_shares
    where share_code = p_share_code and status = 'ACTIVE' for update;
  if not found then raise exception 'This share link is unavailable or has been revoked'; end if;
  if v_share.owner_user_id = v_user_id then raise exception 'You already own this strategy'; end if;
  select * into v_version from public.strategy_share_versions
    where share_id = v_share.id and version = v_share.current_version;
  if not found then raise exception 'Shared strategy version unavailable'; end if;
  v_snapshot := v_version.snapshot_json;

  select * into v_install from public.strategy_share_installs
  where share_id = v_share.id and installer_user_id = v_user_id
  for update;

  if v_install.id is not null and v_install.installed_strategy_id is not null
     and v_install.installed_version = v_share.current_version then
    return jsonb_build_object(
      'installedStrategyId', v_install.installed_strategy_id,
      'installedVersion', v_install.installed_version,
      'created', false,
      'updated', false
    );
  end if;

  if v_install.installed_strategy_id is not null and exists(
    select 1 from public.strategy_profiles
    where id = v_install.installed_strategy_id and user_id = v_user_id
  ) then
    v_strategy_id := v_install.installed_strategy_id;
    delete from public.strategy_instruments where strategy_id = v_strategy_id and user_id = v_user_id;
    delete from public.strategy_sessions where strategy_id = v_strategy_id and user_id = v_user_id;
    delete from public.strategy_rules where strategy_id = v_strategy_id and user_id = v_user_id;
    delete from public.strategy_stop_limits where strategy_id = v_strategy_id and user_id = v_user_id;
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
    v_plan := public.get_effective_plan_code_for_user(v_user_id);
    v_strategy_limit := case v_plan
      when 'FREE' then 1
      when 'PRIVATE_BETA' then 5
      when 'PRO' then 5
      when 'ELITE' then 10
      else null
    end;
    if v_strategy_limit is not null then
      select count(*) into v_active_strategy_count
      from public.strategy_profiles
      where user_id = v_user_id and is_archived = false;
      if v_active_strategy_count >= v_strategy_limit then
        raise exception 'Your % plan allows % active strategies. Archive one before installing this shared strategy.', v_plan, v_strategy_limit;
      end if;
    end if;
    v_created := true;
    v_name := left(coalesce(nullif(trim(v_snapshot->>'name'), ''), 'Shared strategy') || ' · Shared', 120);
    insert into public.strategy_profiles(user_id, name, is_default, is_archived)
    values(v_user_id, v_name, false, false)
    returning id into v_strategy_id;
  end if;

  update public.strategy_profiles set
    name = case when v_created then left(coalesce(nullif(trim(v_snapshot->>'name'), ''), 'Shared strategy') || ' · Shared', 120) else name end,
    description = coalesce(v_snapshot->>'description', ''),
    engine_version = coalesce((v_snapshot->>'engineVersion')::integer, 1),
    market_types = coalesce(array(select jsonb_array_elements_text(v_snapshot->'marketTypes')), array['FOREX']::text[]),
    instruments = coalesce(array(select jsonb_array_elements_text(v_snapshot->'instruments')), array[]::text[]),
    macro_timeframe = nullif(v_snapshot->>'macroTimeframe', ''),
    trend_timeframe = coalesce(nullif(v_snapshot->>'trendTimeframe', ''), 'H4'),
    confirmation_timeframe = coalesce(nullif(v_snapshot->>'confirmationTimeframe', ''), 'H1'),
    entry_timeframe = coalesce(nullif(v_snapshot->>'entryTimeframe', ''), 'M30'),
    trigger_timeframe = nullif(v_snapshot->>'triggerTimeframe', ''),
    minimum_rr = coalesce((v_snapshot->>'minimumRR')::numeric, 3),
    preferred_rr = coalesce((v_snapshot->>'preferredRR')::numeric, (v_snapshot->>'minimumRR')::numeric, 3),
    maximum_risk_percent = coalesce((v_snapshot->>'maximumRiskPercent')::numeric, 0.5),
    maximum_daily_risk_percent = coalesce((v_snapshot->>'maximumDailyRiskPercent')::numeric, 1.5),
    maximum_weekly_risk_percent = coalesce((v_snapshot->>'maximumWeeklyRiskPercent')::numeric, 4),
    maximum_daily_loss_percent = coalesce((v_snapshot->>'maximumDailyLossPercent')::numeric, 2),
    maximum_total_exposure_percent = coalesce((v_snapshot->>'maximumTotalExposurePercent')::numeric, 2),
    maximum_currency_exposure_percent = coalesce((v_snapshot->>'maximumCurrencyExposurePercent')::numeric, 1),
    maximum_trades_per_day = coalesce((v_snapshot->>'maximumTradesPerDay')::integer, 2),
    instrument_trade_limits = coalesce(v_snapshot->'instrumentTradeLimits', '{}'::jsonb),
    green_day_protection_enabled = coalesce((v_snapshot->>'greenDayProtectionEnabled')::boolean, false),
    green_day_protected_floor_mode = coalesce(v_snapshot->>'greenDayProtectedFloorMode', 'ZERO'),
    green_day_protected_floor_value = coalesce((v_snapshot->>'greenDayProtectedFloorValue')::numeric, 0),
    green_day_max_extra_trades = coalesce((v_snapshot->>'greenDayMaxExtraTrades')::integer, 1),
    green_day_extra_risk_multiplier = coalesce((v_snapshot->>'greenDayExtraRiskMultiplier')::numeric, 0.5),
    green_day_require_authorized = coalesce((v_snapshot->>'greenDayRequireAuthorized')::boolean, true),
    maximum_consecutive_losses = coalesce((v_snapshot->>'maximumConsecutiveLosses')::integer, 5),
    allowed_sessions = coalesce(array(select jsonb_array_elements_text(v_snapshot->'allowedSessions')), array[]::text[]),
    avoid_high_impact_news = coalesce((v_snapshot->>'avoidHighImpactNews')::boolean, true),
    news_mode = coalesce(v_snapshot->>'newsMode', 'RELEVANT_CURRENCIES'),
    news_block_minutes_before = coalesce((v_snapshot->>'newsBlockMinutesBefore')::integer, 30),
    news_block_minutes_after = coalesce((v_snapshot->>'newsBlockMinutesAfter')::integer, 15),
    news_currencies = coalesce(array(select jsonb_array_elements_text(v_snapshot->'newsCurrencies')), array['USD','GBP','JPY']::text[]),
    require_trend_alignment = coalesce((v_snapshot->>'requireTrendAlignment')::boolean, true),
    required_evidence = coalesce(array(select jsonb_array_elements_text(v_snapshot->'requiredEvidence')), array[]::text[]),
    evidence_weights = coalesce(v_snapshot->'evidenceWeights', '{}'::jsonb),
    stop_limits = coalesce(v_snapshot->'stopLimits', '{}'::jsonb),
    authorization_score = coalesce((v_snapshot->>'authorizationScore')::integer, 80),
    wait_score = coalesce((v_snapshot->>'waitScore')::integer, 70),
    loss_streak_limit = coalesce((v_snapshot->>'lossStreakLimit')::integer, 5),
    preferred_setups = coalesce(array(select jsonb_array_elements_text(v_snapshot->'preferredSetups')), array[]::text[]),
    reject_unlisted_setups = coalesce((v_snapshot->>'rejectUnlistedSetups')::boolean, false),
    trailing_config = coalesce(v_snapshot->'trailingConfig', '{}'::jsonb),
    exit_config = coalesce(v_snapshot->'exitConfig', '{}'::jsonb),
    monitor_config = coalesce(v_snapshot->'monitorConfig', '{}'::jsonb),
    trading_style = coalesce(v_snapshot->>'tradingStyle', 'day-trading'),
    minimum_holding_minutes = coalesce((v_snapshot->>'minimumHoldingMinutes')::integer, 15),
    strategy_methodologies = coalesce(v_snapshot->'strategyMethodologies', '[]'::jsonb),
    personal_rules = coalesce(v_snapshot->'personalRules', '[]'::jsonb),
    ai_behavior = coalesce(v_snapshot->'aiBehavior', '{}'::jsonb),
    updated_at = now()
  where id = v_strategy_id and user_id = v_user_id;

  insert into public.strategy_instruments(strategy_id,user_id,symbol,market_type,provider_symbol,sort_order,enabled)
  select v_strategy_id, v_user_id, item.value,
    coalesce(v_snapshot->'marketTypes'->>0, 'FOREX'), item.value, item.ordinality - 1, true
  from jsonb_array_elements_text(coalesce(v_snapshot->'instruments', '[]'::jsonb)) with ordinality item(value, ordinality);

  insert into public.strategy_sessions(strategy_id,user_id,session_code,name,timezone,start_time,end_time,days,allow_open_outside,allow_hold_outside,is_custom)
  select v_strategy_id,v_user_id,x."sessionCode",x.name,x.timezone,x."startTime"::time,x."endTime"::time,x.days,x."allowOpenOutside",x."allowHoldOutside",x."isCustom"
  from jsonb_to_recordset(coalesce(v_snapshot->'sessions','[]'::jsonb))
    as x("sessionCode" text,name text,timezone text,"startTime" text,"endTime" text,days smallint[],"allowOpenOutside" boolean,"allowHoldOutside" boolean,"isCustom" boolean);

  insert into public.strategy_rules(strategy_id,user_id,rule_key,label,enabled,mandatory,weight,minimum_confidence,timeframe_role,sort_order,evaluation_mode)
  select v_strategy_id,v_user_id,x."ruleKey",x.label,x.enabled,x.mandatory,x.weight,x."minimumConfidence",x."timeframeRole",item.ordinality - 1,coalesce(x."evaluationMode",'AUTOMATIC')
  from jsonb_array_elements(coalesce(v_snapshot->'rules','[]'::jsonb)) with ordinality item(value, ordinality)
  cross join lateral jsonb_to_record(item.value)
    as x("ruleKey" text,label text,enabled boolean,mandatory boolean,weight numeric,"minimumConfidence" integer,"timeframeRole" text,"evaluationMode" text);

  insert into public.strategy_stop_limits(strategy_id,user_id,instrument,method,minimum_value,preferred_value,maximum_value,atr_multiplier)
  select v_strategy_id,v_user_id,x.instrument,x.method,coalesce(x."minimumValue",0),x."preferredValue",x."maximumValue",x."atrMultiplier"
  from jsonb_to_recordset(coalesce(v_snapshot->'stopLimitSettings','[]'::jsonb))
    as x(instrument text,method text,"minimumValue" numeric,"preferredValue" numeric,"maximumValue" numeric,"atrMultiplier" numeric)
  where x."maximumValue" > 0;

  insert into public.strategy_share_installs(share_id,installer_user_id,installed_strategy_id,installed_version)
  values(v_share.id,v_user_id,v_strategy_id,v_share.current_version)
  on conflict(share_id,installer_user_id) do update set
    installed_strategy_id = excluded.installed_strategy_id,
    installed_version = excluded.installed_version,
    updated_at = now();

  return jsonb_build_object(
    'installedStrategyId', v_strategy_id,
    'installedVersion', v_share.current_version,
    'created', v_created,
    'updated', not v_created
  );
end;
$$;

create or replace function public.revoke_strategy_shares_before_delete_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.strategy_shares
  set status = 'REVOKED', revoked_at = now(), updated_at = now()
  where source_strategy_id = old.id;
  return old;
end;
$$;

create trigger revoke_strategy_shares_before_strategy_delete
before delete on public.strategy_profiles
for each row execute function public.revoke_strategy_shares_before_delete_v1();

revoke all on function public.publish_strategy_share_v1(uuid), public.revoke_strategy_share_v1(uuid),
  public.resolve_strategy_share_v1(uuid), public.install_strategy_share_v1(uuid)
from public, anon;

grant execute on function public.publish_strategy_share_v1(uuid), public.revoke_strategy_share_v1(uuid),
  public.resolve_strategy_share_v1(uuid), public.install_strategy_share_v1(uuid)
to authenticated;

revoke all on function public.reject_strategy_share_version_mutation(), public.revoke_strategy_shares_before_delete_v1()
from public, anon, authenticated;

-- This existing canonicalizer is an internal primitive. Its SECURITY DEFINER
-- body must never be callable directly with an arbitrary strategy id.
revoke all on function public.marketplace_normalize_strategy_profile_for_revision(uuid)
from public, anon, authenticated;
grant execute on function public.marketplace_normalize_strategy_profile_for_revision(uuid)
to service_role;

comment on table public.strategy_shares is 'Private member-to-member strategy invitations. Not Marketplace listings and never a transfer of intellectual property.';
comment on table public.strategy_share_versions is 'Immutable snapshots published by a strategy owner. Recipients install a private copy under a personal-use license.';
comment on table public.strategy_share_installs is 'Records explicit installs and updates; shared strategies are never activated automatically.';

notify pgrst, 'reload schema';
