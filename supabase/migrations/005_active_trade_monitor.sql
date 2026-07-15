create table if not exists public.active_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_profile_id uuid references public.strategy_profiles(id) on delete set null,
  trade_record_id uuid references public.trade_records(id) on delete set null,
  instrument text not null,
  direction text not null check (direction in ('BUY','SELL')),
  entry numeric not null,
  stop_loss numeric not null,
  take_profit numeric not null,
  risk_percent numeric not null default 0.5,
  initial_rr numeric not null,
  setup_type text,
  initial_score numeric,
  initial_analysis jsonb,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  current_price numeric,
  current_r numeric not null default 0,
  mfe_r numeric not null default 0,
  mae_r numeric not null default 0,
  last_verdict text,
  last_verdict_reason text,
  last_analysis jsonb,
  last_price_at timestamptz,
  last_analyzed_at timestamptz,
  taken_against_verdict boolean not null default false,
  original_verdict text,
  original_verdict_reason text,
  override_reason text,
  close_price numeric,
  result_r numeric,
  outcome text,
  close_notes text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.active_trades add column if not exists strategy_profile_id uuid references public.strategy_profiles(id) on delete set null;
alter table public.active_trades add column if not exists trade_record_id uuid references public.trade_records(id) on delete set null;
alter table public.active_trades add column if not exists current_price numeric;
alter table public.active_trades add column if not exists current_r numeric not null default 0;
alter table public.active_trades add column if not exists mfe_r numeric not null default 0;
alter table public.active_trades add column if not exists mae_r numeric not null default 0;
alter table public.active_trades add column if not exists last_verdict text;
alter table public.active_trades add column if not exists last_verdict_reason text;
alter table public.active_trades add column if not exists last_analysis jsonb;
alter table public.active_trades add column if not exists last_price_at timestamptz;
alter table public.active_trades add column if not exists last_analyzed_at timestamptz;
alter table public.active_trades add column if not exists taken_against_verdict boolean not null default false;
alter table public.active_trades add column if not exists original_verdict text;
alter table public.active_trades add column if not exists original_verdict_reason text;
alter table public.active_trades add column if not exists override_reason text;
alter table public.active_trades add column if not exists close_price numeric;
alter table public.active_trades add column if not exists result_r numeric;
alter table public.active_trades add column if not exists outcome text;
alter table public.active_trades add column if not exists close_notes text;
alter table public.active_trades add column if not exists opened_at timestamptz not null default now();
alter table public.active_trades add column if not exists closed_at timestamptz;
alter table public.active_trades add column if not exists updated_at timestamptz not null default now();

create table if not exists public.active_trade_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid not null references public.active_trades(id) on delete cascade,
  event_type text not null,
  verdict text,
  current_price numeric,
  current_r numeric,
  analysis jsonb,
  created_at timestamptz not null default now()
);

create index if not exists active_trades_user_status_idx on public.active_trades(user_id,status,opened_at desc);
create index if not exists active_trade_events_trade_idx on public.active_trade_events(trade_id,created_at desc);

alter table public.active_trades enable row level security;
alter table public.active_trade_events enable row level security;
drop policy if exists active_trades_own on public.active_trades;
create policy active_trades_own on public.active_trades for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists active_trade_events_own on public.active_trade_events;
create policy active_trade_events_own on public.active_trade_events for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update,delete on public.active_trades to authenticated;
grant select,insert,update,delete on public.active_trade_events to authenticated;
