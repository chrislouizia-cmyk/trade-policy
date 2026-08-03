alter table public.active_trades add column if not exists source_decision_id uuid;
alter table public.active_trades add column if not exists source_report_id uuid;

create index if not exists active_trades_source_decision_idx on public.active_trades(source_decision_id);
create index if not exists active_trades_source_report_idx on public.active_trades(source_report_id);
