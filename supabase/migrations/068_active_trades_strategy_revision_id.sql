alter table public.active_trades
  add column if not exists strategy_revision_id text;

comment on column public.active_trades.strategy_revision_id is 'Canonical strategy revision string matching the app contract: "<engineVersion>:<sha256 fingerprint>". Nullable for historical rows that predate revision tracking.';

notify pgrst, 'reload schema';
