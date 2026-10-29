-- Backtesting V1 Phase 1: isolated schema, server-owned lifecycle, and quota ledger.
create table if not exists public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  strategy_profile_id uuid not null references public.strategy_profiles(id) on delete restrict,
  strategy_revision_id text not null,
  strategy_snapshot_hash text not null,
  strategy_snapshot_json jsonb not null,
  instrument text not null default 'XAUUSD' check (instrument = 'XAUUSD'),
  execution_timeframe text not null default 'M15',
  period_start timestamptz not null,
  period_end timestamptz not null,
  starting_balance numeric not null check (starting_balance > 0),
  risk_configuration jsonb not null default '{}'::jsonb,
  execution_model jsonb not null default '{}'::jsonb,
  engine_version text not null default '1.0.0',
  data_provider text not null default 'Twelve Data',
  data_revision_fingerprint text not null default '',
  status text not null check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  failure_reason text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  check (period_end > period_start)
);

create table if not exists public.backtest_trades (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.backtest_runs(id) on delete cascade,
  sequence integer not null,
  signal_timestamp timestamptz not null,
  entry_timestamp timestamptz not null,
  exit_timestamp timestamptz,
  instrument text not null default 'XAUUSD',
  direction text not null check (direction in ('LONG', 'SHORT')),
  entry numeric not null,
  stop_loss numeric,
  take_profit numeric,
  exit_price numeric,
  risk_percent numeric,
  risk_amount numeric,
  balance_before numeric,
  balance_after numeric,
  gross_r numeric,
  net_r numeric,
  gross_pnl numeric,
  net_pnl numeric,
  spread_cost numeric not null default 0,
  slippage_cost numeric not null default 0,
  commission_cost numeric not null default 0,
  setup_type text,
  session text,
  authoritative_rule_snapshot jsonb,
  entry_reason text,
  exit_reason text,
  ambiguous_intrabar boolean not null default false,
  simulation_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.backtest_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.backtest_runs(id) on delete cascade,
  ending_balance numeric,
  net_return_percent numeric,
  total_trades integer,
  wins integer,
  losses integer,
  breakeven integer,
  win_rate numeric,
  profit_factor numeric,
  expectancy_r numeric,
  average_r numeric,
  average_win_r numeric,
  average_loss_r numeric,
  max_drawdown_percent numeric,
  max_drawdown_amount numeric,
  longest_win_streak integer,
  longest_loss_streak integer,
  gross_profit numeric,
  gross_loss numeric,
  total_costs numeric,
  summary_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.backtest_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  plan_code text not null check (plan_code in ('FREE', 'PRO', 'ELITE', 'TEAM')),
  billing_period_start date not null,
  billing_period_end date not null,
  run_count integer not null default 0 check (run_count >= 0),
  limit_value integer not null default 0,
  last_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (billing_period_end > billing_period_start)
);

create index if not exists backtest_runs_user_created_idx on public.backtest_runs(user_id, created_at desc, id desc);
create index if not exists backtest_runs_user_status_idx on public.backtest_runs(user_id, status, created_at desc);
create index if not exists backtest_trades_run_idx on public.backtest_trades(run_id, sequence);
create index if not exists backtest_usage_user_period_idx on public.backtest_usage(user_id, billing_period_start, plan_code);

alter table public.backtest_runs enable row level security;
alter table public.backtest_trades enable row level security;
alter table public.backtest_results enable row level security;
alter table public.backtest_usage enable row level security;

revoke all on table public.backtest_runs from anon, authenticated;
revoke all on table public.backtest_trades from anon, authenticated;
revoke all on table public.backtest_results from anon, authenticated;
revoke all on table public.backtest_usage from anon, authenticated;

grant select on table public.backtest_runs to authenticated;
grant select on table public.backtest_trades to authenticated;
grant select on table public.backtest_results to authenticated;
grant select on table public.backtest_usage to authenticated;

grant select, insert, update, delete on table public.backtest_runs to service_role;
grant select, insert, update, delete on table public.backtest_trades to service_role;
grant select, insert, update, delete on table public.backtest_results to service_role;
grant select, insert, update, delete on table public.backtest_usage to service_role;

create policy "backtest_runs_select_own" on public.backtest_runs for select to authenticated using ((select auth.uid()) = user_id);
create policy "backtest_runs_insert_own" on public.backtest_runs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "backtest_runs_update_own" on public.backtest_runs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "backtest_runs_delete_own" on public.backtest_runs for delete to authenticated using ((select auth.uid()) = user_id);

create policy "backtest_trades_select_own" on public.backtest_trades for select to authenticated using (
  exists (
    select 1
    from public.backtest_runs br
    where br.id = backtest_trades.run_id
      and br.user_id = (select auth.uid())
  )
);
create policy "backtest_trades_insert_own" on public.backtest_trades for insert to authenticated with check (
  exists (
    select 1
    from public.backtest_runs br
    where br.id = backtest_trades.run_id
      and br.user_id = (select auth.uid())
  )
);
create policy "backtest_trades_update_own" on public.backtest_trades for update to authenticated using (
  exists (
    select 1
    from public.backtest_runs br
    where br.id = backtest_trades.run_id
      and br.user_id = (select auth.uid())
  )
) with check (
  exists (
    select 1
    from public.backtest_runs br
    where br.id = backtest_trades.run_id
      and br.user_id = (select auth.uid())
  )
);
create policy "backtest_trades_delete_own" on public.backtest_trades for delete to authenticated using (
  exists (
    select 1
    from public.backtest_runs br
    where br.id = backtest_trades.run_id
      and br.user_id = (select auth.uid())
  )
);

create policy "backtest_results_select_own" on public.backtest_results for select to authenticated using (
  exists (
    select 1
    from public.backtest_runs br
    where br.id = backtest_results.run_id
      and br.user_id = (select auth.uid())
  )
);
create policy "backtest_results_insert_own" on public.backtest_results for insert to authenticated with check (
  exists (
    select 1
    from public.backtest_runs br
    where br.id = backtest_results.run_id
      and br.user_id = (select auth.uid())
  )
);
create policy "backtest_results_update_own" on public.backtest_results for update to authenticated using (
  exists (
    select 1
    from public.backtest_runs br
    where br.id = backtest_results.run_id
      and br.user_id = (select auth.uid())
  )
) with check (
  exists (
    select 1
    from public.backtest_runs br
    where br.id = backtest_results.run_id
      and br.user_id = (select auth.uid())
  )
);
create policy "backtest_results_delete_own" on public.backtest_results for delete to authenticated using (
  exists (
    select 1
    from public.backtest_runs br
    where br.id = backtest_results.run_id
      and br.user_id = (select auth.uid())
  )
);

create policy "backtest_usage_select_own" on public.backtest_usage for select to authenticated using ((select auth.uid()) = user_id);
create policy "backtest_usage_insert_own" on public.backtest_usage for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "backtest_usage_update_own" on public.backtest_usage for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "backtest_usage_delete_own" on public.backtest_usage for delete to authenticated using ((select auth.uid()) = user_id);

create unique index if not exists backtest_usage_user_workspace_period_unique
  on public.backtest_usage (user_id, workspace_id, plan_code, billing_period_start);

comment on table public.backtest_runs is 'Server-owned historical backtesting runs. Never used for live trading state.';
comment on table public.backtest_trades is 'Simulated trade execution ledger for a backtest run. Never writes to live trade tables.';
comment on table public.backtest_results is 'Summary metrics for a completed backtest run.';
comment on table public.backtest_usage is 'Monthly backtest quota ledger, server-enforced per plan.';
