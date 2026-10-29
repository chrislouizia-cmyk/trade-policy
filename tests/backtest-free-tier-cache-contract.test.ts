import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/082_backtest_historical_cache.sql', 'utf8');
const cache = fs.readFileSync('lib/server/backtest-historical-cache.ts', 'utf8');
const route = fs.readFileSync('app/api/backtests/[id]/execute/route.ts', 'utf8');
const detail = fs.readFileSync('components/StrategyDetailPage.tsx', 'utf8');

test('082 stores reusable provider candles and coverage with service-role-only writes', () => {
  assert.match(migration, /backtest_historical_candles/);
  assert.match(migration, /backtest_historical_cache_ranges/);
  assert.match(migration, /revoke all .* authenticated/);
  assert.match(migration, /grant select, insert, update, delete .* service_role/);
});

test('free-tier acquisition never intentionally spends a ninth provider call', () => {
  assert.match(cache, /PROVIDER_CALL_BUDGET = 8/);
  assert.match(cache, /requestsUsed >= PROVIDER_CALL_BUDGET/);
  assert.match(cache, /retryAfterSeconds: 65/);
});

test('historical cache persists provider coverage between execution attempts', () => {
  assert.match(cache, /backtest_historical_cache_ranges/);
  assert.match(cache, /backtest_historical_candles/);
  assert.match(cache, /\.upsert\(rows/);
});

test('run stays queued while historical data is incomplete and claims only after preparation', () => {
  const prepareAt = route.indexOf('prepareHistoricalBacktestData');
  const claimAt = route.indexOf("backtest_claim_run_atomic");
  assert.ok(prepareAt >= 0 && claimAt > prepareAt);
  assert.match(route, /preparingHistoricalData: true/);
  assert.match(route, /status: 'QUEUED'/);
});

test('client continues the same queued run after the provider window resets', () => {
  assert.match(detail, /payload\?\.preparingHistoricalData/);
  assert.match(detail, /window\.setTimeout/);
  assert.match(detail, /executeQueuedRun\(runId\)/);
});
