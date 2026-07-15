-- Trade Police v8 beta foundation: trading accounts, auditable balance ledger,
-- strategy snapshots on trades, and safe atomic trade closure.

create table if not exists public.trading_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  broker text,
  account_type text not null default 'PAPER' check (account_type in ('PAPER','DEMO','LIVE','FUNDED')),
  currency text not null default 'USD',
  initial_balance numeric not null check (initial_balance >= 0),
  current_balance numeric not null check (current_balance >= 0),
  is_active boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists one_active_trading_account_per_user
  on public.trading_accounts(user_id) where is_active = true and is_archived = false;
create index if not exists trading_accounts_user_idx
  on public.trading_accounts(user_id, is_archived, created_at desc);

create table if not exists public.account_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.trading_accounts(id) on delete cascade,
  trade_id uuid references public.active_trades(id) on delete set null,
  trade_record_id uuid references public.trade_records(id) on delete set null,
  entry_type text not null check (entry_type in (
    'INITIAL_BALANCE','TRADE_PROFIT','TRADE_LOSS','TRADE_BREAKEVEN',
    'DEPOSIT','WITHDRAWAL','FEE','COMMISSION','SWAP','MANUAL_ADJUSTMENT'
  )),
  amount numeric not null,
  balance_before numeric not null,
  balance_after numeric not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_ledger_account_idx
  on public.account_ledger(account_id, created_at desc);
create index if not exists account_ledger_user_idx
  on public.account_ledger(user_id, created_at desc);

alter table public.active_trades add column if not exists account_id uuid references public.trading_accounts(id) on delete set null;
alter table public.active_trades add column if not exists balance_at_entry numeric;
alter table public.active_trades add column if not exists risk_amount numeric;
alter table public.active_trades add column if not exists realized_pnl numeric;
alter table public.active_trades add column if not exists fees numeric not null default 0;
alter table public.active_trades add column if not exists balance_after_close numeric;
alter table public.active_trades add column if not exists strategy_name_at_entry text;
alter table public.active_trades add column if not exists strategy_snapshot jsonb not null default '{}'::jsonb;

alter table public.trade_records add column if not exists account_id uuid references public.trading_accounts(id) on delete set null;
alter table public.trade_records add column if not exists balance_at_entry numeric;
alter table public.trade_records add column if not exists risk_amount numeric;
alter table public.trade_records add column if not exists realized_pnl numeric;
alter table public.trade_records add column if not exists fees numeric not null default 0;
alter table public.trade_records add column if not exists balance_after_close numeric;
alter table public.trade_records add column if not exists strategy_profile_id uuid references public.strategy_profiles(id) on delete set null;
alter table public.trade_records add column if not exists strategy_name_at_entry text;

alter table public.trading_accounts enable row level security;
alter table public.account_ledger enable row level security;

drop policy if exists trading_accounts_own on public.trading_accounts;
create policy trading_accounts_own on public.trading_accounts
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists account_ledger_own on public.account_ledger;
create policy account_ledger_own on public.account_ledger
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.trading_accounts to authenticated;
grant select, insert, update, delete on public.account_ledger to authenticated;

create or replace function public.set_active_trading_account(target_account_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.trading_accounts
    where id = target_account_id and user_id = auth.uid() and is_archived = false
  ) then
    raise exception 'Trading account not found or unavailable';
  end if;

  update public.trading_accounts
  set is_active = false, updated_at = now()
  where user_id = auth.uid() and is_active = true;

  update public.trading_accounts
  set is_active = true, updated_at = now()
  where id = target_account_id and user_id = auth.uid();
end;
$$;

grant execute on function public.set_active_trading_account(uuid) to authenticated;

create or replace function public.close_active_trade_with_ledger(
  p_trade_id uuid,
  p_close_price numeric,
  p_fees numeric default 0,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_trade public.active_trades%rowtype;
  v_account public.trading_accounts%rowtype;
  v_result_r numeric;
  v_risk_distance numeric;
  v_gross_pnl numeric;
  v_realized_pnl numeric;
  v_new_balance numeric;
  v_outcome text;
  v_now timestamptz := now();
begin
  select * into v_trade
  from public.active_trades
  where id = p_trade_id and user_id = auth.uid()
  for update;

  if not found then raise exception 'Active trade not found'; end if;
  if v_trade.status <> 'OPEN' then raise exception 'Trade is already closed'; end if;
  if p_close_price is null or p_close_price <= 0 then raise exception 'Invalid close price'; end if;

  v_risk_distance := abs(v_trade.entry - v_trade.stop_loss);
  if v_risk_distance = 0 then raise exception 'Invalid risk distance'; end if;

  v_result_r := case when v_trade.direction = 'BUY'
    then (p_close_price - v_trade.entry) / v_risk_distance
    else (v_trade.entry - p_close_price) / v_risk_distance end;

  v_gross_pnl := v_result_r * coalesce(v_trade.risk_amount, 0);
  v_realized_pnl := v_gross_pnl - greatest(coalesce(p_fees, 0), 0);
  v_outcome := case when v_result_r > 0.05 then 'WIN' when v_result_r < -0.05 then 'LOSS' else 'BREAKEVEN' end;

  if v_trade.account_id is not null then
    select * into v_account
    from public.trading_accounts
    where id = v_trade.account_id and user_id = auth.uid()
    for update;

    if not found then raise exception 'Trading account not found'; end if;
    v_new_balance := v_account.current_balance + v_realized_pnl;
    if v_new_balance < 0 then raise exception 'Closing result would create a negative balance'; end if;

    update public.trading_accounts
    set current_balance = v_new_balance, updated_at = v_now
    where id = v_account.id;

    insert into public.account_ledger(
      user_id, account_id, trade_id, trade_record_id, entry_type, amount,
      balance_before, balance_after, description, metadata
    ) values (
      auth.uid(), v_account.id, v_trade.id, v_trade.trade_record_id,
      case when v_realized_pnl > 0 then 'TRADE_PROFIT'
           when v_realized_pnl < 0 then 'TRADE_LOSS'
           else 'TRADE_BREAKEVEN' end,
      v_realized_pnl, v_account.current_balance, v_new_balance,
      coalesce(p_notes, v_trade.instrument || ' ' || v_trade.direction || ' closed'),
      jsonb_build_object('result_r', v_result_r, 'gross_pnl', v_gross_pnl, 'fees', greatest(coalesce(p_fees,0),0), 'close_price', p_close_price)
    );
  else
    v_new_balance := null;
  end if;

  update public.active_trades
  set status = 'CLOSED', close_price = p_close_price, result_r = v_result_r,
      outcome = v_outcome, close_notes = p_notes, realized_pnl = v_realized_pnl,
      fees = greatest(coalesce(p_fees,0),0), balance_after_close = v_new_balance,
      closed_at = v_now, updated_at = v_now
  where id = v_trade.id;

  if v_trade.trade_record_id is not null then
    update public.trade_records
    set status = 'CLOSED', outcome = v_outcome, result_r = v_result_r,
        realized_pnl = v_realized_pnl, fees = greatest(coalesce(p_fees,0),0),
        balance_after_close = v_new_balance, closed_at = v_now, updated_at = v_now
    where id = v_trade.trade_record_id and user_id = auth.uid();
  end if;

  insert into public.active_trade_events(user_id, trade_id, event_type, verdict, current_price, current_r, analysis)
  values (auth.uid(), v_trade.id, 'CLOSED', 'CLOSED', p_close_price, v_result_r,
    jsonb_build_object('outcome', v_outcome, 'realized_pnl', v_realized_pnl, 'fees', greatest(coalesce(p_fees,0),0), 'balance_after', v_new_balance, 'notes', p_notes));

  return jsonb_build_object(
    'trade_id', v_trade.id, 'outcome', v_outcome, 'result_r', v_result_r,
    'realized_pnl', v_realized_pnl, 'balance_after', v_new_balance
  );
end;
$$;

grant execute on function public.close_active_trade_with_ledger(uuid,numeric,numeric,text) to authenticated;
