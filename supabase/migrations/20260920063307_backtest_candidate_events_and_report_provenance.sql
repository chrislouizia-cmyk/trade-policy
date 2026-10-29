-- Persist the material candidate ledger and report provenance without changing
-- the strategy rules or the official simulated trade ledger.

create unique index if not exists backtest_runs_id_user_unique
  on public.backtest_runs (id, user_id);

create table if not exists public.backtest_candidate_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  candidate_key text not null,
  signal_timestamp_utc timestamptz not null,
  direction text check (direction is null or direction in ('LONG', 'SHORT')),
  disposition text not null check (disposition in ('TAKEN', 'REJECTED', 'ABORTED', 'OVERRIDE_ELIGIBLE')),
  terminal_stage text not null,
  terminal_reason text not null,
  blocking_rule_id text,
  rule_evaluations jsonb not null default '[]'::jsonb check (jsonb_typeof(rule_evaluations) = 'array'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  official_trade_sequence integer,
  official_performance boolean not null default false,
  hypothetical jsonb,
  created_at timestamptz not null default now(),
  foreign key (run_id, user_id) references public.backtest_runs(id, user_id) on delete cascade,
  unique (run_id, candidate_key),
  check (
    (disposition = 'TAKEN' and official_performance and official_trade_sequence is not null and hypothetical is null)
    or
    (disposition <> 'TAKEN' and not official_performance and official_trade_sequence is null)
  ),
  check (hypothetical is null or jsonb_typeof(hypothetical) = 'object')
);

create index if not exists backtest_candidate_events_user_run_time_idx
  on public.backtest_candidate_events (user_id, run_id, signal_timestamp_utc, id);

create index if not exists backtest_candidate_events_run_disposition_time_idx
  on public.backtest_candidate_events (run_id, disposition, signal_timestamp_utc, id);

alter table public.backtest_candidate_events enable row level security;
alter table public.backtest_candidate_events force row level security;

revoke all on table public.backtest_candidate_events from public, anon, authenticated;
grant select on table public.backtest_candidate_events to authenticated;
grant select, insert on table public.backtest_candidate_events to service_role;

drop policy if exists "backtest_candidate_events_select_own" on public.backtest_candidate_events;
create policy "backtest_candidate_events_select_own"
  on public.backtest_candidate_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.backtest_candidate_events is
  'Immutable material-opportunity ledger for completed historical backtests. Rejected and aborted events never contribute to official performance.';

-- This wrapper participates in the same Postgres transaction as the existing
-- completion function. If candidate persistence fails, completion and credit
-- consumption roll back together.
create or replace function public.backtest_complete_run_with_evidence_atomic(
  p_user_id uuid,
  p_run_id uuid,
  p_result jsonb,
  p_trades jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_candidates jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completion jsonb;
  v_candidates_written integer := 0;
  v_fingerprint text;
begin
  if jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'Backtest candidate events payload must be a JSON array.';
  end if;

  v_completion := public.backtest_complete_run_atomic(
    p_user_id,
    p_run_id,
    p_result,
    p_trades,
    p_metadata
  );

  insert into public.backtest_candidate_events (
    run_id,
    user_id,
    candidate_key,
    signal_timestamp_utc,
    direction,
    disposition,
    terminal_stage,
    terminal_reason,
    blocking_rule_id,
    rule_evaluations,
    evidence,
    official_trade_sequence,
    official_performance,
    hypothetical
  )
  select
    p_run_id,
    p_user_id,
    candidate.value ->> 'candidate_key',
    (candidate.value ->> 'signal_timestamp_utc')::timestamptz,
    nullif(candidate.value ->> 'direction', ''),
    candidate.value ->> 'disposition',
    candidate.value ->> 'terminal_stage',
    candidate.value ->> 'terminal_reason',
    nullif(candidate.value ->> 'blocking_rule_id', ''),
    coalesce(candidate.value -> 'rule_evaluations', '[]'::jsonb),
    coalesce(candidate.value -> 'evidence', '{}'::jsonb),
    (candidate.value ->> 'official_trade_sequence')::integer,
    coalesce((candidate.value ->> 'official_performance')::boolean, false),
    nullif(candidate.value -> 'hypothetical', 'null'::jsonb)
  from jsonb_array_elements(p_candidates) as candidate(value)
  on conflict (run_id, candidate_key) do nothing;

  get diagnostics v_candidates_written = row_count;

  v_fingerprint := nullif(p_metadata ->> 'historical_data_fingerprint', '');
  if v_fingerprint is not null then
    update public.backtest_runs
       set data_revision_fingerprint = v_fingerprint
     where id = p_run_id
       and user_id = p_user_id
       and status = 'COMPLETED'
       and coalesce(data_revision_fingerprint, '') = '';
  end if;

  return v_completion || jsonb_build_object(
    'candidate_events_written', v_candidates_written,
    'data_revision_fingerprint', v_fingerprint
  );
end;
$$;

revoke all on function public.backtest_complete_run_with_evidence_atomic(uuid, uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.backtest_complete_run_with_evidence_atomic(uuid, uuid, jsonb, jsonb, jsonb, jsonb)
  to service_role;

notify pgrst, 'reload schema';
