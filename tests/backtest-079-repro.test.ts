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

test('079 patches legacy 077/078 upgrade state before validating the contract and reconciles missing run reservations', () => {
  assert.match(migration, /update public\.backtest_usage\s+set\s+limit_count = case/i);
  assert.match(migration, /when upper\(coalesce\(nullif\(trim\(plan_code\), ''\), 'FREE'\)\) = 'FREE' then 0/i);
  assert.match(migration, /when upper\(coalesce\(nullif\(trim\(plan_code\), ''\), 'FREE'\)\) = 'FOUNDER' then null/i);
  assert.match(migration, /unlimited = case[\s\S]*when upper\(coalesce\(nullif\(trim\(plan_code\), ''\), 'FREE'\)\) = 'FOUNDER' then true/i);
  assert.match(migration, /check \(\(\(unlimited = true\) and \(limit_count is null\)\) or \(\(unlimited = false\) and \(limit_count is not null\) and \(limit_count >= 0\)\)\)/i);
  assert.match(migration, /insert into public\.backtest_credit_reservations/i);
  assert.match(migration, /on conflict \(run_id\) do nothing/i);
  assert.match(migration, /case\s*\n\s*when br\.status in \('QUEUED', 'RUNNING'\) then 'RESERVED'/i);
  assert.match(migration, /when br\.status in \('FAILED', 'CANCELLED'\) then 'LEGACY_RUN_RECONCILIATION'/i);
  assert.match(migration, /with legacy_run_usage as/i);
  assert.match(migration, /count\(\*\) filter \(where status = 'CONSUMED'\)\s*::integer as used_count/i);
  assert.match(migration, /count\(\*\) filter \(where status = 'RESERVED'\)\s*::integer as reserved_count/i);
  assert.match(migration, /not lru\.unlimited as counts_against_limit/i);
  assert.match(migration, /update public\.backtest_usage bu\s+set used_count = coalesce\(rc\.used_count, 0\),\s+reserved_count = coalesce\(rc\.reserved_count, 0\)/i);
});
