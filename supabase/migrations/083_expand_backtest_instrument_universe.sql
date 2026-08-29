-- Trade Police 083 — canonical initial backtest instrument universe.
-- Aligns backtest_runs with the application instrument registry.
begin;

alter table public.backtest_runs
  drop constraint if exists backtest_runs_instrument_check;

alter table public.backtest_runs
  add constraint backtest_runs_instrument_check
  check (instrument in ('EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'EURAUD', 'GBPAUD', 'AUDJPY', 'CADJPY', 'CHFJPY', 'XAUUSD', 'XAGUSD'));

commit;
