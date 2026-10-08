import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const route = fs.readFileSync('app/api/backtests/[id]/execute/route.ts', 'utf8');

test('historical preparation exceptions keep the run queued and retryable', () => {
  assert.match(route, /try\s*\{\s*preparation = await prepareHistoricalBacktestData/);
  assert.match(route, /Backtest historical preparation failed/);
  assert.match(route, /status:\s*'QUEUED'/);
  assert.match(route, /preparingHistoricalData:\s*true/);
  assert.match(route, /retryAfterSeconds:\s*65/);
  assert.match(route, /Retry-After':\s*'65'/);
});

test('preparation failure does not fail or release the reserved run', () => {
  const prepStart = route.indexOf("let preparation;");
  const claimStart = route.indexOf("backtest_claim_run_atomic");
  assert.ok(prepStart >= 0 && claimStart > prepStart);
  const prepBlock = route.slice(prepStart, claimStart);
  assert.doesNotMatch(prepBlock, /backtest_fail_run_atomic/);
  assert.doesNotMatch(prepBlock, /BACKTEST_EXECUTION_FAILED/);
});

test('execution failures after claim are still handled separately', () => {
  assert.match(route, /backtest_fail_run_atomic/);
  assert.match(route, /HISTORICAL_MARKET_DATA_UNAVAILABLE/);
  assert.match(route, /BACKTEST_EXECUTION_FAILED/);
});
