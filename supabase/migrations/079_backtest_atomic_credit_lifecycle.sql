-- Backtesting atomic credit lifecycle: reproduce the validated live contract from the local DB.
-- This migration is intentionally additive and forward-only: it closes the schema delta between
-- 077/078 and the live local runtime that already validated create/claim/complete/fail quotas.

-- 0) Founder entitlement contract must match the runtime billing table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'billing_subscriptions'
      AND column_name = 'plan'
  ) THEN
    ALTER TABLE public.billing_subscriptions
      DROP CONSTRAINT IF EXISTS billing_subscriptions_plan_check;

    ALTER TABLE public.billing_subscriptions
      ADD CONSTRAINT billing_subscriptions_plan_check
      CHECK (plan in ('FREE', 'PRO', 'TEAM', 'FOUNDER'))
      NOT VALID;

    ALTER TABLE public.billing_subscriptions
      VALIDATE CONSTRAINT billing_subscriptions_plan_check;
  END IF;
END $$;

-- 1) Delta for backtest_usage
alter table public.backtest_usage
  add column if not exists used_count integer not null default 0;

alter table public.backtest_usage
  add column if not exists reserved_count integer not null default 0;

alter table public.backtest_usage
  add column if not exists limit_count integer;

alter table public.backtest_usage
  add column if not exists unlimited boolean not null default false;

alter table public.backtest_usage
  add column if not exists run_count integer;

alter table public.backtest_usage
  add column if not exists limit_value integer;

alter table public.backtest_usage
  add column if not exists last_run_id uuid;

alter table public.backtest_usage
  add column if not exists workspace_id uuid;

alter table public.backtest_usage
  add column if not exists plan_code text;

alter table public.backtest_usage
  alter column used_count set default 0;

alter table public.backtest_usage
  alter column reserved_count set default 0;

-- Backfill legacy 077/078 rows before validating the runtime contract. This keeps
-- existing plan limits and founder unlimited status aligned with the live billing rules.
update public.backtest_usage
   set limit_count = case
         when upper(coalesce(nullif(trim(plan_code), ''), 'FREE')) = 'FREE' then 0
         when upper(coalesce(nullif(trim(plan_code), ''), 'FREE')) = 'PRIVATE_BETA' then 10
         when upper(coalesce(nullif(trim(plan_code), ''), 'FREE')) = 'PRO' then 3
         when upper(coalesce(nullif(trim(plan_code), ''), 'FREE')) = 'ELITE' then 10
         when upper(coalesce(nullif(trim(plan_code), ''), 'FREE')) = 'TEAM' then 70
         when upper(coalesce(nullif(trim(plan_code), ''), 'FREE')) = 'FOUNDER' then null
         else 0
       end,
       unlimited = case
         when upper(coalesce(nullif(trim(plan_code), ''), 'FREE')) = 'FOUNDER' then true
         else false
       end,
       updated_at = now();

-- Ensure the plan contract matches the live runtime: PRIVATE_BETA and FOUNDER both valid.
-- This is safe even if the older repo migration already inserted a narrower check.
alter table public.backtest_usage
  drop constraint if exists backtest_usage_plan_code_check;

alter table public.backtest_usage
  add constraint backtest_usage_plan_code_check
  check (plan_code = any (array['FREE'::text, 'PRIVATE_BETA'::text, 'PRO'::text, 'ELITE'::text, 'TEAM'::text, 'FOUNDER'::text]))
  not valid;

alter table public.backtest_usage
  validate constraint backtest_usage_plan_code_check;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.backtest_usage'::regclass
      and conname = 'backtest_usage_limit_contract'
  ) then
    alter table public.backtest_usage
      add constraint backtest_usage_limit_contract
      check (((unlimited = true) and (limit_count is null)) or ((unlimited = false) and (limit_count is not null) and (limit_count >= 0)))
      not valid;
  end if;
end $$;

alter table public.backtest_usage
  validate constraint backtest_usage_limit_contract;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.backtest_usage'::regclass
      and conname = 'backtest_usage_used_count_nonnegative'
  ) then
    alter table public.backtest_usage
      add constraint backtest_usage_used_count_nonnegative
      check (used_count >= 0)
      not valid;
  end if;
end $$;

alter table public.backtest_usage
  validate constraint backtest_usage_used_count_nonnegative;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.backtest_usage'::regclass
      and conname = 'backtest_usage_reserved_count_nonnegative'
  ) then
    alter table public.backtest_usage
      add constraint backtest_usage_reserved_count_nonnegative
      check (reserved_count >= 0)
      not valid;
  end if;
end $$;

alter table public.backtest_usage
  validate constraint backtest_usage_reserved_count_nonnegative;

-- 2) Delta for backtest_runs
alter table public.backtest_runs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.backtest_runs
  add column if not exists idempotency_key text;

alter table public.backtest_runs
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists backtest_runs_user_idempotency_unique
  on public.backtest_runs (user_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists backtest_trades_run_sequence_unique
  on public.backtest_trades (run_id, sequence);

-- 3) Create the missing reservation ledger and enforce its state machine.
create table if not exists public.backtest_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.backtest_runs(id) on delete cascade,
  usage_id uuid not null references public.backtest_usage(id) on delete restrict,
  period_start date not null,
  status text not null check (status in ('RESERVED', 'CONSUMED', 'RELEASED')),
  counts_against_limit boolean not null default true,
  reserved_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'RESERVED' and consumed_at is null and released_at is null and release_reason is null)
    or (status = 'CONSUMED' and consumed_at is not null and released_at is null and release_reason is null)
    or (status = 'RELEASED' and consumed_at is null and released_at is not null and release_reason is not null)
  )
);

create unique index if not exists backtest_credit_reservations_run_id_key
  on public.backtest_credit_reservations (run_id);

create index if not exists backtest_credit_reservations_user_period_status_idx
  on public.backtest_credit_reservations (user_id, period_start, status);

-- Reconcile any queued/running/completed/failed legacy backtest runs that never received a reservation.
-- This is idempotent and safe on empty databases because it uses an insert ... on conflict guard.
do $$
begin
  with legacy_run_usage as (
    select
      br.id as run_id,
      br.user_id,
      br.workspace_id,
      br.created_at,
      br.started_at,
      br.completed_at,
      br.updated_at,
      bu.id as usage_id,
      bu.billing_period_start,
      bu.billing_period_end,
      bu.unlimited,
      row_number() over (
        partition by br.id
        order by
          case when bu.last_run_id = br.id then 0 else 1 end,
          bu.updated_at desc nulls last,
          bu.created_at desc nulls last,
          bu.id
      ) as row_rank
    from public.backtest_runs br
    join public.backtest_usage bu
      on bu.user_id = br.user_id
     and bu.workspace_id is not distinct from br.workspace_id
     and br.created_at >= bu.billing_period_start
     and br.created_at < bu.billing_period_end
    where not exists (
      select 1
      from public.backtest_credit_reservations bcr
      where bcr.run_id = br.id
    )
  )
  insert into public.backtest_credit_reservations (
    user_id,
    run_id,
    usage_id,
    period_start,
    status,
    counts_against_limit,
    reserved_at,
    consumed_at,
    released_at,
    release_reason,
    created_at,
    updated_at
  )
  select
    lru.user_id,
    lru.run_id,
    lru.usage_id,
    lru.billing_period_start,
    case
      when br.status in ('QUEUED', 'RUNNING') then 'RESERVED'
      when br.status = 'COMPLETED' then 'CONSUMED'
      when br.status in ('FAILED', 'CANCELLED') then 'RELEASED'
      else 'RESERVED'
    end as status,
    not lru.unlimited as counts_against_limit,
    coalesce(br.started_at, br.created_at, br.updated_at, now()) as reserved_at,
    case
      when br.status = 'COMPLETED' then coalesce(br.completed_at, br.started_at, br.created_at, br.updated_at, now())
      else null
    end as consumed_at,
    case
      when br.status in ('FAILED', 'CANCELLED') then coalesce(br.completed_at, br.started_at, br.created_at, br.updated_at, now())
      else null
    end as released_at,
    case
      when br.status in ('FAILED', 'CANCELLED') then 'LEGACY_RUN_RECONCILIATION'
      else null
    end as release_reason,
    coalesce(br.created_at, now()) as created_at,
    coalesce(br.updated_at, now()) as updated_at
  from legacy_run_usage lru
  join public.backtest_runs br on br.id = lru.run_id
  where lru.row_rank = 1
  on conflict (run_id) do nothing;
end $$;

with reservation_counts as (
  select
    usage_id,
    count(*) filter (where status = 'CONSUMED')::integer as used_count,
    count(*) filter (where status = 'RESERVED')::integer as reserved_count
  from public.backtest_credit_reservations
  group by usage_id
)
update public.backtest_usage bu
   set used_count = coalesce(rc.used_count, 0),
       reserved_count = coalesce(rc.reserved_count, 0),
       updated_at = now()
  from reservation_counts rc
 where rc.usage_id = bu.id;

update public.backtest_usage bu
   set used_count = 0,
       reserved_count = 0,
       updated_at = now()
 where not exists (
   select 1
   from public.backtest_credit_reservations bcr
   where bcr.usage_id = bu.id
 );

-- 4) Reconcile usage ledger uniqueness with the live runtime.
create unique index if not exists backtest_usage_user_workspace_period_unique
  on public.backtest_usage (user_id, workspace_id, plan_code, billing_period_start)
  where workspace_id is not null;

create unique index if not exists backtest_usage_user_null_workspace_period_unique
  on public.backtest_usage (user_id, plan_code, billing_period_start)
  where workspace_id is null;

-- 5) Backtest plan resolution should mirror the validated live contract.
create or replace function public.backtest_get_plan_code_for_user(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_status text;
  v_founder_override text;
begin
  v_founder_override := null;
  if exists (
    select 1
    from public.billing_subscriptions bs
    where bs.user_id = p_user_id
      and bs.plan = 'FOUNDER'
      and bs.status in ('active', 'trialing')
    limit 1
  ) then
    return 'FOUNDER';
  end if;

  select bs.plan, bs.status
    into v_plan, v_status
  from public.billing_subscriptions bs
  where bs.user_id = p_user_id
  order by bs.updated_at desc
  limit 1;

  if v_plan is null then
    return 'FREE';
  end if;

  if lower(v_plan) = 'private_beta' then
    return 'PRIVATE_BETA';
  end if;

  if lower(v_status) not in ('active', 'trialing') then
    return 'FREE';
  end if;

  return upper(v_plan);
end;
$$;

-- 6) Atomic creation: reserve credits, lock user-period quotas and prevent duplicate idempotent retries.
create or replace function public.backtest_create_run_atomic(
  p_user_id uuid,
  p_workspace_id uuid,
  p_strategy_profile_id uuid,
  p_strategy_revision_id text,
  p_strategy_snapshot_hash text,
  p_strategy_snapshot_json jsonb,
  p_instrument text,
  p_execution_timeframe text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_starting_balance numeric,
  p_risk_configuration jsonb default '{}'::jsonb,
  p_execution_model jsonb default '{}'::jsonb,
  p_engine_version text default '1.0.0'::text,
  p_data_provider text default 'Twelve Data'::text,
  p_data_revision_fingerprint text default ''::text,
  p_metadata jsonb default '{}'::jsonb,
  p_plan_code text default 'FREE'::text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_code text;
  v_limit integer;
  v_run_id uuid;
  v_existing jsonb;
  v_usage_id uuid;
  v_usage public.backtest_usage%rowtype;
  v_now timestamptz;
  v_period_start_date date;
  v_period_end_date date;
  v_unlimited boolean;
  v_total_used integer;
  v_total_reserved integer;
begin
  if p_user_id is null then
    raise exception 'Backtest user context is required.';
  end if;

  if p_strategy_profile_id is null then
    raise exception 'A strategy profile is required to create a backtest run.';
  end if;

  if p_period_end <= p_period_start then
    raise exception 'Backtest period end must be after start.';
  end if;

  v_plan_code := upper(coalesce(nullif(trim(p_plan_code), ''), public.backtest_get_plan_code_for_user(p_user_id)));
  v_limit := case
    when upper(v_plan_code) = 'FREE' then 0
    when upper(v_plan_code) = 'PRIVATE_BETA' then 10
    when upper(v_plan_code) = 'PRO' then 3
    when upper(v_plan_code) = 'ELITE' then 10
    when upper(v_plan_code) = 'TEAM' then 70
    when upper(v_plan_code) = 'FOUNDER' then null
    else 0
  end;

  v_now := now();
  v_period_start_date := date_trunc('month', v_now)::date;
  v_period_end_date := (date_trunc('month', v_now) + interval '1 month')::date;
  v_unlimited := v_limit is null;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_period_start_date::text, 0));

  if p_idempotency_key is not null then
    select to_jsonb(br)
      into v_existing
    from public.backtest_runs br
    where br.user_id = p_user_id
      and br.idempotency_key = p_idempotency_key
    limit 1;

    if v_existing is not null then
      return jsonb_build_object(
        'run_id', v_existing->>'id',
        'status', v_existing->>'status',
        'duplicate', true,
        'idempotency_key', p_idempotency_key,
        'run', v_existing
      );
    end if;
  end if;

  select bu.id
    into v_usage_id
  from public.backtest_usage bu
  where bu.user_id = p_user_id
    and bu.workspace_id is not distinct from p_workspace_id
    and bu.plan_code = v_plan_code
    and bu.billing_period_start = v_period_start_date
  limit 1;

  if v_usage_id is null then
    insert into public.backtest_usage (
      user_id,
      workspace_id,
      plan_code,
      billing_period_start,
      billing_period_end,
      used_count,
      reserved_count,
      limit_count,
      unlimited,
      last_run_id,
      created_at,
      updated_at
    ) values (
      p_user_id,
      p_workspace_id,
      v_plan_code,
      v_period_start_date,
      v_period_end_date,
      0,
      0,
      v_limit,
      v_unlimited,
      null,
      v_now,
      v_now
    )
    returning id into v_usage_id;
  else
    update public.backtest_usage
       set limit_count = v_limit,
           unlimited = v_unlimited,
           updated_at = v_now
     where id = v_usage_id;
  end if;

  select *
    into v_usage
  from public.backtest_usage bu
  where bu.id = v_usage_id
  for update;

  select coalesce(sum(bu.used_count), 0)::integer,
         coalesce(sum(bu.reserved_count), 0)::integer
    into v_total_used, v_total_reserved
  from public.backtest_usage bu
  where bu.user_id = p_user_id
    and bu.plan_code = v_plan_code
    and bu.billing_period_start = v_period_start_date;

  if not v_usage.unlimited and (v_total_used + v_total_reserved) >= v_usage.limit_count then
    raise exception 'Backtest quota exceeded for plan %.', v_plan_code;
  end if;

  insert into public.backtest_runs (
    user_id,
    workspace_id,
    strategy_profile_id,
    strategy_revision_id,
    strategy_snapshot_hash,
    strategy_snapshot_json,
    instrument,
    execution_timeframe,
    period_start,
    period_end,
    starting_balance,
    risk_configuration,
    execution_model,
    engine_version,
    data_provider,
    data_revision_fingerprint,
    status,
    failure_reason,
    metadata,
    idempotency_key,
    created_at,
    updated_at
  ) values (
    p_user_id,
    p_workspace_id,
    p_strategy_profile_id,
    p_strategy_revision_id,
    p_strategy_snapshot_hash,
    p_strategy_snapshot_json,
    p_instrument,
    p_execution_timeframe,
    p_period_start,
    p_period_end,
    p_starting_balance,
    p_risk_configuration,
    p_execution_model,
    p_engine_version,
    p_data_provider,
    p_data_revision_fingerprint,
    'QUEUED',
    null,
    p_metadata,
    p_idempotency_key,
    v_now,
    v_now
  )
  returning id into v_run_id;

  insert into public.backtest_credit_reservations (
    user_id,
    run_id,
    usage_id,
    period_start,
    status,
    counts_against_limit,
    reserved_at,
    created_at,
    updated_at
  ) values (
    p_user_id,
    v_run_id,
    v_usage_id,
    v_period_start_date,
    'RESERVED',
    not v_unlimited,
    v_now,
    v_now,
    v_now
  );

  update public.backtest_usage
     set reserved_count = reserved_count + 1,
         last_run_id = v_run_id,
         updated_at = v_now
   where id = v_usage_id;

  return jsonb_build_object(
    'run_id', v_run_id,
    'status', 'QUEUED',
    'duplicate', false,
    'idempotency_key', p_idempotency_key,
    'usage_id', v_usage_id,
    'used', v_total_used,
    'reserved', v_total_reserved + 1,
    'limit', v_limit,
    'remaining', case when v_unlimited then null else v_limit - v_total_used - v_total_reserved - 1 end,
    'unlimited', v_unlimited,
    'plan_code', v_plan_code
  );
end;
$$;

-- 7) Atomic claim: only queued runs may become running.
create or replace function public.backtest_claim_run_atomic(p_user_id uuid, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run jsonb;
begin
  update public.backtest_runs
     set status = 'RUNNING',
         started_at = now(),
         updated_at = now()
   where id = p_run_id
     and user_id = p_user_id
     and status = 'QUEUED'
   returning to_jsonb(backtest_runs) into v_run;

  if v_run is null then
    return jsonb_build_object('run_id', p_run_id, 'claimed', false, 'status', 'QUEUED');
  end if;

  return jsonb_build_object('run_id', p_run_id, 'claimed', true, 'status', 'RUNNING', 'run', v_run);
end;
$$;

-- 8) Atomic completion: only RUNNING can complete, reserved credits become consumed, and result/trades persist.
create or replace function public.backtest_complete_run_atomic(
  p_user_id uuid,
  p_run_id uuid,
  p_result jsonb,
  p_trades jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run record;
  v_reservation record;
  v_usage public.backtest_usage%rowtype;
  v_completed_run jsonb;
  v_existing_result jsonb;
begin
  select *
    into v_run
  from public.backtest_runs br
  where br.id = p_run_id
    and br.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Backtest run was not found for completion.';
  end if;

  if v_run.status = 'COMPLETED' then
    select to_jsonb(result_row)
      into v_existing_result
    from public.backtest_results result_row
    where result_row.run_id = p_run_id;

    return jsonb_build_object(
      'run_id', p_run_id,
      'status', 'COMPLETED',
      'completed', true,
      'idempotent', true,
      'result', v_existing_result,
      'trades_written', (select count(*) from public.backtest_trades bt where bt.run_id = p_run_id)
    );
  end if;

  if v_run.status <> 'RUNNING' then
    raise exception 'Backtest run cannot transition from % to COMPLETED.', v_run.status;
  end if;

  select *
    into v_reservation
  from public.backtest_credit_reservations reservation
  where reservation.run_id = p_run_id
    and reservation.user_id = p_user_id
  for update;

  if not found or v_reservation.status <> 'RESERVED' then
    raise exception 'Backtest completion requires one RESERVED credit reservation.';
  end if;

  select *
    into v_usage
  from public.backtest_usage usage_row
  where usage_row.id = v_reservation.usage_id
  for update;

  if not found or v_usage.reserved_count <= 0 then
    raise exception 'Backtest reserved credit accounting is inconsistent.';
  end if;

  if jsonb_typeof(p_trades) <> 'array' then
    raise exception 'Backtest trades payload must be a JSON array.';
  end if;

  insert into public.backtest_trades (
    run_id,
    sequence,
    signal_timestamp,
    entry_timestamp,
    exit_timestamp,
    instrument,
    direction,
    entry,
    stop_loss,
    take_profit,
    exit_price,
    risk_percent,
    risk_amount,
    balance_before,
    balance_after,
    gross_r,
    net_r,
    gross_pnl,
    net_pnl,
    spread_cost,
    slippage_cost,
    commission_cost,
    setup_type,
    session,
    authoritative_rule_snapshot,
    entry_reason,
    exit_reason,
    ambiguous_intrabar,
    simulation_metadata
  )
  select
    p_run_id,
    (trade.value ->> 'sequence')::integer,
    (trade.value ->> 'signal_timestamp')::timestamptz,
    (trade.value ->> 'entry_timestamp')::timestamptz,
    (trade.value ->> 'exit_timestamp')::timestamptz,
    coalesce(trade.value ->> 'instrument', v_run.instrument),
    coalesce(trade.value ->> 'direction', 'LONG'),
    (trade.value ->> 'entry')::numeric,
    (trade.value ->> 'stop_loss')::numeric,
    (trade.value ->> 'take_profit')::numeric,
    (trade.value ->> 'exit_price')::numeric,
    (trade.value ->> 'risk_percent')::numeric,
    (trade.value ->> 'risk_amount')::numeric,
    (trade.value ->> 'balance_before')::numeric,
    (trade.value ->> 'balance_after')::numeric,
    (trade.value ->> 'gross_r')::numeric,
    (trade.value ->> 'net_r')::numeric,
    (trade.value ->> 'gross_pnl')::numeric,
    (trade.value ->> 'net_pnl')::numeric,
    coalesce((trade.value ->> 'spread_cost')::numeric, 0),
    coalesce((trade.value ->> 'slippage_cost')::numeric, 0),
    coalesce((trade.value ->> 'commission_cost')::numeric, 0),
    trade.value ->> 'setup_type',
    trade.value ->> 'session',
    coalesce(trade.value -> 'authoritative_rule_snapshot', '{}'::jsonb),
    trade.value ->> 'entry_reason',
    trade.value ->> 'exit_reason',
    coalesce((trade.value ->> 'ambiguous_intrabar')::boolean, false),
    coalesce(trade.value -> 'simulation_metadata', '{}'::jsonb)
  from jsonb_array_elements(p_trades) as trade(value)
  on conflict (run_id, sequence) do nothing;

  insert into public.backtest_results (
    run_id,
    ending_balance,
    net_return_percent,
    total_trades,
    wins,
    losses,
    breakeven,
    win_rate,
    profit_factor,
    expectancy_r,
    average_r,
    average_win_r,
    average_loss_r,
    max_drawdown_percent,
    max_drawdown_amount,
    summary_snapshot,
    created_at
  ) values (
    p_run_id,
    coalesce((p_result ->> 'ending_balance')::numeric, v_run.starting_balance),
    (p_result ->> 'net_return_percent')::numeric,
    (p_result ->> 'total_trades')::integer,
    (p_result ->> 'wins')::integer,
    (p_result ->> 'losses')::integer,
    (p_result ->> 'breakeven')::integer,
    (p_result ->> 'win_rate')::numeric,
    (p_result ->> 'profit_factor')::numeric,
    (p_result ->> 'expectancy_r')::numeric,
    (p_result ->> 'average_r')::numeric,
    (p_result ->> 'average_win_r')::numeric,
    (p_result ->> 'average_loss_r')::numeric,
    (p_result ->> 'max_drawdown_percent')::numeric,
    (p_result ->> 'max_drawdown_amount')::numeric,
    coalesce(p_result, '{}'::jsonb),
    now()
  )
  on conflict (run_id)
  do update set
    ending_balance = excluded.ending_balance,
    net_return_percent = excluded.net_return_percent,
    total_trades = excluded.total_trades,
    wins = excluded.wins,
    losses = excluded.losses,
    breakeven = excluded.breakeven,
    win_rate = excluded.win_rate,
    profit_factor = excluded.profit_factor,
    expectancy_r = excluded.expectancy_r,
    average_r = excluded.average_r,
    average_win_r = excluded.average_win_r,
    average_loss_r = excluded.average_loss_r,
    max_drawdown_percent = excluded.max_drawdown_percent,
    max_drawdown_amount = excluded.max_drawdown_amount,
    summary_snapshot = excluded.summary_snapshot,
    created_at = now();

  update public.backtest_credit_reservations
     set status = 'CONSUMED',
         consumed_at = now(),
         released_at = null,
         release_reason = null,
         updated_at = now()
   where id = v_reservation.id
     and status = 'RESERVED';

  update public.backtest_usage
     set reserved_count = reserved_count - 1,
         used_count = used_count + 1,
         updated_at = now()
   where id = v_reservation.usage_id
     and reserved_count > 0;

  update public.backtest_runs
     set status = 'COMPLETED',
         completed_at = now(),
         updated_at = now(),
         failure_reason = null,
         metadata = metadata || coalesce(p_metadata, '{}'::jsonb)
   where id = p_run_id
     and user_id = p_user_id
     and status = 'RUNNING'
   returning to_jsonb(backtest_runs) into v_completed_run;

  if v_completed_run is null then
    raise exception 'Backtest run completion lost its RUNNING claim.';
  end if;

  return jsonb_build_object(
    'run_id', p_run_id,
    'status', 'COMPLETED',
    'completed', true,
    'idempotent', false,
    'credit_status', 'CONSUMED',
    'result_written', true,
    'trades_written', jsonb_array_length(coalesce(p_trades, '[]'::jsonb))
  );
end;
$$;

-- 9) Atomic failure: only RUNNING can fail; reserved credits are released and the run is marked failed.
create or replace function public.backtest_fail_run_atomic(p_user_id uuid, p_run_id uuid, p_failure_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run jsonb;
  v_run_record record;
  v_reservation record;
  v_usage public.backtest_usage%rowtype;
  v_release_reason text;
begin
  select *
    into v_run_record
  from public.backtest_runs br
  where br.id = p_run_id
    and br.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Backtest run was not found for failure handling.';
  end if;

  if v_run_record.status = 'FAILED' then
    return jsonb_build_object(
      'run_id', p_run_id,
      'status', 'FAILED',
      'failed', true,
      'idempotent', true,
      'reason', v_run_record.failure_reason,
      'run', to_jsonb(v_run_record)
    );
  end if;

  if v_run_record.status <> 'RUNNING' then
    return jsonb_build_object(
      'run_id', p_run_id,
      'status', v_run_record.status,
      'failed', false,
      'idempotent', true,
      'reason', 'Run is no longer eligible for failure handling.',
      'run', to_jsonb(v_run_record)
    );
  end if;

  select *
    into v_reservation
  from public.backtest_credit_reservations reservation
  where reservation.run_id = p_run_id
    and reservation.user_id = p_user_id
  for update;

  if not found or v_reservation.status <> 'RESERVED' then
    raise exception 'Backtest failure requires one RESERVED credit reservation.';
  end if;

  select *
    into v_usage
  from public.backtest_usage usage_row
  where usage_row.id = v_reservation.usage_id
  for update;

  if not found or v_usage.reserved_count <= 0 then
    raise exception 'Backtest reserved credit accounting is inconsistent.';
  end if;

  v_release_reason := case
    when p_failure_reason ilike '%timeout%' or p_failure_reason ilike '%aborted%' then 'TIMEOUT'
    when p_failure_reason ilike '%provider%' or p_failure_reason ilike '%market data%' then 'PROVIDER_ERROR'
    else 'INTERNAL_ERROR'
  end;

  update public.backtest_runs
     set status = 'FAILED',
         failure_reason = p_failure_reason,
         completed_at = now(),
         updated_at = now()
   where id = p_run_id
     and user_id = p_user_id
     and status = 'RUNNING'
   returning to_jsonb(backtest_runs) into v_run;

  update public.backtest_credit_reservations
     set status = 'RELEASED',
         released_at = now(),
         consumed_at = null,
         release_reason = v_release_reason,
         updated_at = now()
   where id = v_reservation.id
     and status = 'RESERVED';

  update public.backtest_usage
     set reserved_count = reserved_count - 1,
         updated_at = now()
   where id = v_reservation.usage_id
     and reserved_count > 0;

  return jsonb_build_object(
    'run_id', p_run_id,
    'status', 'FAILED',
    'failed', true,
    'idempotent', false,
    'reason', p_failure_reason,
    'credit_status', 'RELEASED',
    'release_reason', v_release_reason,
    'run', v_run
  );
end;
$$;

-- 10) Security model: server-owned mutators remain callable by service_role only.
alter table public.backtest_credit_reservations enable row level security;
revoke all on table public.backtest_credit_reservations from public, anon, authenticated;
grant select on table public.backtest_credit_reservations to authenticated;
grant select, insert, update, delete on table public.backtest_credit_reservations to service_role;

create policy "backtest_credit_reservations_select_own" on public.backtest_credit_reservations for select to authenticated using ((select auth.uid()) = user_id);

revoke all on function public.backtest_get_plan_code_for_user(uuid) from public, anon, authenticated;
revoke all on function public.backtest_create_run_atomic(
  uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz, timestamptz, numeric,
  jsonb, jsonb, text, text, text, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.backtest_claim_run_atomic(uuid, uuid) from public, anon, authenticated;
revoke all on function public.backtest_complete_run_atomic(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.backtest_fail_run_atomic(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.backtest_get_plan_code_for_user(uuid) to service_role;
grant execute on function public.backtest_create_run_atomic(
  uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz, timestamptz, numeric,
  jsonb, jsonb, text, text, text, jsonb, text, text
) to service_role;
grant execute on function public.backtest_claim_run_atomic(uuid, uuid) to service_role;
grant execute on function public.backtest_complete_run_atomic(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.backtest_fail_run_atomic(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
