-- Trade Police 082 — shared historical backtest cache
-- Provider data is global/non-user-specific and is writable only by service_role.

create table if not exists public.backtest_historical_candles (
  provider text not null,
  instrument text not null,
  timeframe text not null,
  opened_at timestamptz not null,
  closed_at timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric null,
  created_at timestamptz not null default now(),
  primary key (provider, instrument, timeframe, opened_at)
);

create index if not exists backtest_historical_candles_lookup_idx
  on public.backtest_historical_candles (provider, instrument, timeframe, opened_at);

create table if not exists public.backtest_historical_cache_ranges (
  provider text not null,
  instrument text not null,
  timeframe text not null,
  covered_start timestamptz not null,
  covered_end timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (provider, instrument, timeframe),
  check (covered_end > covered_start)
);

alter table public.backtest_historical_candles enable row level security;
alter table public.backtest_historical_cache_ranges enable row level security;

revoke all on public.backtest_historical_candles from anon, authenticated;
revoke all on public.backtest_historical_cache_ranges from anon, authenticated;

grant select, insert, update, delete on public.backtest_historical_candles to service_role;
grant select, insert, update, delete on public.backtest_historical_cache_ranges to service_role;
