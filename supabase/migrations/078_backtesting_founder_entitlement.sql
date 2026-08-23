-- Backtesting V1 founder entitlement fix: allow founder backtest plan support without altering live backtest run data.
-- This is an append-only schema correction for the already-applied 077 migration.

ALTER TABLE public.backtest_usage
  DROP CONSTRAINT IF EXISTS backtest_usage_plan_code_check;

ALTER TABLE public.backtest_usage
  ADD CONSTRAINT backtest_usage_plan_code_check
  CHECK (plan_code IN ('FREE', 'PRO', 'ELITE', 'TEAM', 'FOUNDER'))
  NOT VALID;

ALTER TABLE public.backtest_usage
  VALIDATE CONSTRAINT backtest_usage_plan_code_check;
