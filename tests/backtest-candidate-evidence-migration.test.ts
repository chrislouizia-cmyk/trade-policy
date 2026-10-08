import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/20260920063307_backtest_candidate_events_and_report_provenance.sql', import.meta.url), 'utf8');

test('candidate evidence is owner-readable, service-written, and transactionally completed', () => {
  assert.match(migration, /create table if not exists public\.backtest_candidate_events/i);
  assert.match(migration, /foreign key \(run_id, user_id\) references public\.backtest_runs\(id, user_id\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/i);
  assert.match(migration, /grant select on table public\.backtest_candidate_events to authenticated/i);
  assert.match(migration, /grant select, insert on table public\.backtest_candidate_events to service_role/i);
  assert.doesNotMatch(migration, /grant[^;]*(update|delete)[^;]*backtest_candidate_events/i);
  assert.match(migration, /backtest_complete_run_with_evidence_atomic/i);
  assert.match(migration, /v_completion := public\.backtest_complete_run_atomic/i);
  assert.match(migration, /on conflict \(run_id, candidate_key\) do nothing/i);
  assert.match(migration, /nullif\(candidate\.value -> 'hypothetical', 'null'::jsonb\)/i);
  assert.match(migration, /disposition = 'TAKEN'[\s\S]*official_performance[\s\S]*official_trade_sequence is not null/i);
  assert.match(migration, /disposition <> 'TAKEN'[\s\S]*not official_performance[\s\S]*official_trade_sequence is null/i);
});
