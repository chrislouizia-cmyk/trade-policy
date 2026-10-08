-- Prevent concurrent requests from creating contradictory active-trade state.
create unique index if not exists one_open_trade_per_user_instrument
  on public.active_trades(user_id, instrument)
  where status = 'OPEN';

create unique index if not exists one_active_trade_per_trade_record
  on public.active_trades(trade_record_id)
  where trade_record_id is not null;
