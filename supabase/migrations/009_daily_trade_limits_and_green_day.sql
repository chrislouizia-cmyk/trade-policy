-- Trade Police v10: daily limits per instrument and Green Day Protection.

alter table public.strategy_profiles
  add column if not exists instrument_trade_limits jsonb not null default '{}'::jsonb,
  add column if not exists green_day_protection_enabled boolean not null default false,
  add column if not exists green_day_protected_floor_mode text not null default 'ZERO'
    check (green_day_protected_floor_mode in ('ZERO','FIXED','PERCENT_OF_PROFIT')),
  add column if not exists green_day_protected_floor_value numeric not null default 0,
  add column if not exists green_day_max_extra_trades integer not null default 1 check (green_day_max_extra_trades between 0 and 10),
  add column if not exists green_day_extra_risk_multiplier numeric not null default 0.5 check (green_day_extra_risk_multiplier > 0 and green_day_extra_risk_multiplier <= 1),
  add column if not exists green_day_require_authorized boolean not null default true;

update public.strategy_profiles
set instrument_trade_limits = coalesce(instrument_trade_limits, '{}'::jsonb),
    green_day_protection_enabled = coalesce(green_day_protection_enabled, false),
    green_day_protected_floor_mode = coalesce(green_day_protected_floor_mode, 'ZERO'),
    green_day_protected_floor_value = coalesce(green_day_protected_floor_value, 0),
    green_day_max_extra_trades = coalesce(green_day_max_extra_trades, 1),
    green_day_extra_risk_multiplier = coalesce(green_day_extra_risk_multiplier, 0.5),
    green_day_require_authorized = coalesce(green_day_require_authorized, true);

create index if not exists trade_records_daily_strategy_instrument_idx
  on public.trade_records(user_id, strategy_profile_id, instrument, created_at desc)
  where source = 'EXECUTED';
