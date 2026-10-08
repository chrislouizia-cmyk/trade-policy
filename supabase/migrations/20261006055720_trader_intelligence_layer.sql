create table if not exists public.trader_intelligence_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 80),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_refresh_at timestamptz
);

create table if not exists public.trader_intelligence_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'ACCOUNT_SEEN','PAGE_VIEW','DECISION_CREATED','TRADE_OPENED',
    'TRADE_REANALYZED','TRADE_CLOSED','FEEDBACK_SAVED','BACKTEST_COMPLETED'
  )),
  route text check (route is null or char_length(route) <= 160),
  context jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists trader_intelligence_events_user_time_idx
  on public.trader_intelligence_events(user_id, occurred_at desc);
create index if not exists trader_intelligence_profiles_refresh_idx
  on public.trader_intelligence_profiles(last_refresh_at nulls first);

alter table public.trader_intelligence_profiles enable row level security;
alter table public.trader_intelligence_events enable row level security;
alter table public.trader_intelligence_profiles force row level security;
alter table public.trader_intelligence_events force row level security;

revoke all on public.trader_intelligence_profiles from public, anon, authenticated;
revoke all on public.trader_intelligence_events from public, anon, authenticated;
grant select on public.trader_intelligence_profiles to authenticated;
grant select, insert, update, delete on public.trader_intelligence_profiles to service_role;
grant select, insert, update, delete on public.trader_intelligence_events to service_role;

drop policy if exists trader_intelligence_profiles_read_own
  on public.trader_intelligence_profiles;
create policy trader_intelligence_profiles_read_own
  on public.trader_intelligence_profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.trader_intelligence_profiles is
  'Per-trader learning clock and IANA timezone. Server writes only.';
comment on table public.trader_intelligence_events is
  'Minimal product interaction signals for personal intelligence. No message or chart contents.';
