alter table public.active_trades
  add column if not exists activation_mode text default 'READY' check (activation_mode in ('READY', 'OVERRIDE'));

alter table public.active_trades
  add column if not exists override_conditions jsonb not null default '[]'::jsonb;

create index if not exists active_trades_activation_mode_idx
  on public.active_trades (user_id, activation_mode, opened_at desc);

create index if not exists active_trades_override_reason_idx
  on public.active_trades (user_id, override_reason, opened_at desc);

comment on column public.active_trades.activation_mode is 'Trade activation mode: READY for compliant authorization or OVERRIDE for an explicit override/take-anyway trade.';
comment on column public.active_trades.override_conditions is 'Structured list of override conditions used when a trader takes a trade against the original decision verdict.';
