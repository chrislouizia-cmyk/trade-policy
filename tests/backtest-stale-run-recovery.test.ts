import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  BACKTEST_EXECUTION_TIMEOUT_SECONDS,
  BACKTEST_STALE_LEASE_SECONDS,
  backtestLeaseExpiresAt,
  isBacktestLeaseStale,
} from '../lib/backtesting/run-lifecycle.ts';

const route = fs.readFileSync('app/api/backtests/[id]/execute/route.ts', 'utf8');
const detail = fs.readFileSync('components/StrategyDetailPage.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/089_recover_stale_backtest_runs.sql', 'utf8');

test('execution lease expires only after the configured function timeout plus safety margin', () => {
  assert.equal(BACKTEST_EXECUTION_TIMEOUT_SECONDS, 300);
  assert.equal(BACKTEST_STALE_LEASE_SECONDS, 360);
  const run = { status: 'RUNNING', started_at: '2026-09-02T00:00:00.000Z' };
  assert.equal(backtestLeaseExpiresAt(run), Date.parse(run.started_at) + 360_000);
  assert.equal(isBacktestLeaseStale(run, Date.parse(run.started_at) + 359_999), false);
  assert.equal(isBacktestLeaseStale(run, Date.parse(run.started_at) + 360_000), true);
  assert.equal(isBacktestLeaseStale({ status: 'QUEUED', started_at: run.started_at }, Date.now()), false);
});

test('executor reclaims stale work before claiming the same run again', () => {
  assert.match(route, /maxDuration = 300/);
  assert.match(route, /backtest_reclaim_stale_run_atomic/);
  assert.ok(route.indexOf('backtest_reclaim_stale_run_atomic') < route.indexOf('backtest_claim_run_atomic'));
  assert.match(route, /STALE_RUN_RECLAIMED/);
  assert.match(route, /SIMULATION_COMPLETED/);
});

test('stale recovery preserves the reservation and is service-role only', () => {
  assert.match(migration, /status = 'QUEUED'/);
  assert.match(migration, /'credit_status', 'RESERVED'/);
  assert.doesNotMatch(migration, /reserved_count\s*=\s*reserved_count\s*-/);
  assert.match(migration, /revoke all on function public\.backtest_reclaim_stale_run_atomic[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.backtest_reclaim_stale_run_atomic[\s\S]*to service_role/i);
});

test('running backtests can check progress and expose recovery after the lease expires', () => {
  assert.match(detail, /run\.status === 'RUNNING'\) void executeQueuedRun\(run\.id\)/);
  assert.match(detail, /isBacktestLeaseStale\(run\)/);
  assert.match(detail, /'Recover run'/);
  assert.match(detail, /'Refresh status'/);
});
