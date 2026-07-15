-- Trade Police v3: configurable strategies per user
create table if not exists public.strategy_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  instruments text[] not null default array['XAUUSD','GBPUSD','GBPJPY'],
  trend_timeframe text not null default 'H4',
  confirmation_timeframe text not null default 'H1',
  entry_timeframe text not null default 'M30',
  minimum_rr numeric not null default 3,
  maximum_risk_percent numeric not null default 0.5,
  maximum_trades_per_day integer not null default 2,
  allowed_sessions text[] not null default array['LONDON','NEW_YORK'],
  avoid_high_impact_news boolean not null default true,
  require_trend_alignment boolean not null default true,
  required_evidence text[] not null default array['h4TrendAligned','h1TrendAligned','structurePattern','liquiditySweep','chochConfirmed','bosConfirmed'],
  evidence_weights jsonb not null default '{"h4TrendAligned":10,"h1TrendAligned":10,"structurePattern":10,"liquiditySweep":10,"chochConfirmed":10,"bosConfirmed":10,"orderBlock":7,"fairValueGap":7,"retestConfirmed":6}'::jsonb,
  stop_limits jsonb not null default '{"XAUUSD":2,"GBPUSD":0.003,"GBPJPY":0.30}'::jsonb,
  authorization_score integer not null default 80,
  wait_score integer not null default 70,
  loss_streak_limit integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists one_default_strategy_per_user on public.strategy_profiles(user_id) where is_default;
create index if not exists strategy_profiles_user_idx on public.strategy_profiles(user_id,created_at desc);
alter table public.strategy_profiles enable row level security;
create policy "strategies_select_own" on public.strategy_profiles for select to authenticated using ((select auth.uid())=user_id);
create policy "strategies_insert_own" on public.strategy_profiles for insert to authenticated with check ((select auth.uid())=user_id);
create policy "strategies_update_own" on public.strategy_profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "strategies_delete_own" on public.strategy_profiles for delete to authenticated using ((select auth.uid())=user_id);
grant select,insert,update,delete on public.strategy_profiles to authenticated;
