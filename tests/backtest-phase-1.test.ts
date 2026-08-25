import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/077_backtesting_v1_phase_1.sql', import.meta.url), 'utf8');
const backtestRoute = readFileSync(new URL('../app/api/backtests/route.ts', import.meta.url), 'utf8');
const runRoute = readFileSync(new URL('../app/api/backtests/[id]/route.ts', import.meta.url), 'utf8');
const helper = readFileSync(new URL('../lib/server/backtesting.ts', import.meta.url), 'utf8');

test('backtesting tables are created in an isolated append-only migration', () => {
  assert.match(migration, /create table if not exists public\.backtest_runs/i);
  assert.match(migration, /create table if not exists public\.backtest_trades/i);
  assert.match(migration, /create table if not exists public\.backtest_results/i);
  assert.match(migration, /create table if not exists public\.backtest_usage/i);
  assert.match(migration, /comment on table public\.backtest_runs is 'Server-owned historical backtesting runs/i);
  assert.match(migration, /Never used for live trading state\./i);
  assert.match(migration, /Never writes to live trade tables\./i);
});

test('live trading tables are never used by the backtesting schema or server helpers', () => {
  assert.doesNotMatch(migration, /insert into public\.active_trades/i);
  assert.doesNotMatch(migration, /insert into public\.trade_records/i);
  assert.doesNotMatch(migration, /insert into public\.account_ledger/i);
  assert.doesNotMatch(migration, /insert into public\.analytics/i);
  assert.doesNotMatch(helper, /insert\s+into\s+public\.active_trades/i);
  assert.doesNotMatch(helper, /insert\s+into\s+public\.trade_records/i);
  assert.doesNotMatch(helper, /insert\s+into\s+public\.account_ledger/i);
});

test('RLS grants require ownership reads and server-role writes', () => {
  assert.match(migration, /alter table public\.backtest_runs enable row level security/i);
  assert.match(migration, /create policy "backtest_runs_select_own" on public\.backtest_runs/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.backtest_runs to service_role/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.backtest_trades to service_role/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.backtest_results to service_role/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.backtest_usage to service_role/i);
});

test('quota is server-side with plan limits and no client trust path', () => {
  assert.match(helper, /BACKTEST_PLAN_LIMITS/i);
  assert.match(helper, /FREE: 0/i);
  assert.match(helper, /PRIVATE_BETA: 10/i);
  assert.match(helper, /PRO: 3/i);
  assert.match(helper, /ELITE: 10/i);
  assert.match(helper, /TEAM: 70/i);
  assert.match(helper, /FOUNDER:\s*null/i);
  assert.match(helper, /checkBacktestQuota\(/i);
  assert.match(helper, /if \(!quota\.allowed\)/i);
  assert.doesNotMatch(helper, /localStorage|sessionStorage|window\./i);
});

test('private beta receives server-owned backtest credits without requiring a paid subscription', () => {
  assert.match(helper, /PRIVATE_BETA:\s*10/i);
  assert.match(helper, /if \(plan === 'PRIVATE_BETA'\) \{\s*return 'PRIVATE_BETA';\s*\}/is);
  assert.doesNotMatch(helper, /localStorage|sessionStorage|window\./i);
});

test('founder backtests are unlimited and bypass the monthly cap', () => {
  assert.match(helper, /FOUNDER:\s*null/i);
  assert.match(helper, /return normalized in BACKTEST_PLAN_LIMITS \? BACKTEST_PLAN_LIMITS\[normalized as BacktestPlanCode\] : 0;/i);
  assert.match(helper, /limit === null \|\| \(Number\(usage\.run_count \?\? 0\) < Number\(limit\)\)/i);
});

test('backtest plan resolution honors the server-side founder override before querying billing state', () => {
  assert.match(helper, /serverEntitlementOverride\(userId\)/i);
  assert.match(helper, /if \(founderOverride\) \{\s*return founderOverride;/is);
  assert.doesNotMatch(helper, /return '\w+';\s*\n\s*const admin = createAdminClient\(\);/i);
});

test('backtest plan limits preserve the canonical unlimited representation and finite plan values', () => {
  assert.match(helper, /PRO:\s*3/i);
  assert.match(helper, /ELITE:\s*10/i);
  assert.match(helper, /TEAM:\s*70/i);
  assert.match(helper, /FOUNDER:\s*null/i);
  assert.doesNotMatch(helper, /FOUNDER:\s*0/i);
  assert.doesNotMatch(helper, /limitValue === null \? 'Unlimited backtests' : limitValue === 0 \? 'No backtest plan access'/i);
});

test('POST /api/backtests authenticates and freezes strategy state before creating a queued run', () => {
  assert.match(backtestRoute, /auth\.getUser\(\)/i);
  assert.match(backtestRoute, /freezeStrategyForBacktest/i);
  assert.match(backtestRoute, /strategyRevisionId: frozen\.strategyRevisionId/i);
  assert.match(backtestRoute, /createBacktestRun\(/i);
  assert.match(helper, /status:\s*'QUEUED'/i);
  assert.match(backtestRoute, /return NextResponse\.json\(\{\s*runId: run\.id/i);
});

test('GET routes are scoped to the authenticated user and run id', () => {
  assert.match(backtestRoute, /eq\('user_id', user.id\)/i);
  assert.match(runRoute, /getBacktestRunForUser\(user.id, id\)/i);
  assert.match(runRoute, /BACKTEST_NOT_FOUND/i);
});

test('completed runs are immutable except operational fields and strategy snapshot is frozen at creation', () => {
  assert.match(migration, /status text not null check \(status in \('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'\)\)/i);
  assert.match(migration, /strategy_snapshot_hash text not null/i);
  assert.match(migration, /strategy_snapshot_json jsonb not null/i);
  assert.match(migration, /failure_reason text/i);
  assert.match(migration, /created_at timestamptz not null default now\(\)/i);
  assert.match(helper, /strategySnapshotHash: fingerprint/i);
  assert.match(helper, /strategySnapshotJson: JSON\.parse\(JSON\.stringify\(strategy\)\)/i);
});
