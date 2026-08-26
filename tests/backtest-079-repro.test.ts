import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = new URL('../supabase/migrations/079_backtest_atomic_credit_lifecycle.sql', import.meta.url);
const migration = readFileSync(migrationPath, 'utf8');

test('079 migration is present and covers the live backtesting lifecycle contract', () => {
  assert.match(migration, /create table if not exists public\.backtest_credit_reservations/i);
  assert.match(migration, /backtest_get_plan_code_for_user/i);
  assert.match(migration, /backtest_create_run_atomic/i);
  assert.match(migration, /backtest_claim_run_atomic/i);
  assert.match(migration, /backtest_complete_run_atomic/i);
  assert.match(migration, /backtest_fail_run_atomic/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS backtest_runs_user_idempotency_unique/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS backtest_credit_reservations_run_id_key/i);
  assert.match(migration, /SECURITY DEFINER/i);
  assert.match(migration, /set search_path\s*(?:=|to)\s*public/i);
  assert.match(migration, /grant execute on function public\.backtest_create_run_atomic/i);
  assert.match(migration, /grant execute on function public\.backtest_claim_run_atomic/i);
  assert.match(migration, /grant execute on function public\.backtest_complete_run_atomic/i);
  assert.match(migration, /grant execute on function public\.backtest_fail_run_atomic/i);
});

test('079 includes the live quota and lifecycle semantics required for atomic credits', () => {
  assert.match(migration, /reserved_count = reserved_count \+ 1/i);
  assert.match(migration, /reserved_count = reserved_count - 1/i);
  assert.match(migration, /used_count = used_count \+ 1/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /Backtest quota exceeded for plan/i);
  assert.match(migration, /Backtest run cannot transition from % to COMPLETED\./i);
  assert.match(migration, /Backtest run cannot transition from % to FAILED\.|Run is no longer eligible for failure handling\./i);
  assert.match(migration, /v_total_used \+ v_total_reserved/i);
});
