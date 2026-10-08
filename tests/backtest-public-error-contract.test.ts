import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const route = fs.readFileSync('app/api/backtests/[id]/execute/route.ts', 'utf8');

test('backtest provider failures keep internal detail server-side', () => {
  assert.match(route, /console\.error\('Backtest execution failed'/);
  assert.match(route, /internalReason: reason/);
  assert.doesNotMatch(route, /apiError\('BACKTEST_EXECUTION_FAILED', reason/);
});

test('provider quota and rate errors use a safe public response', () => {
  assert.match(route, /HISTORICAL_MARKET_DATA_UNAVAILABLE/);
  assert.match(route, /Historical market data is temporarily unavailable\. Please try again shortly\./);
  assert.match(route, /providerUnavailable \? 503 : 422/);
});

test('provider details are persisted for diagnosis but not returned as the public message', () => {
  assert.match(route, /p_failure_reason: reason/);
  assert.match(route, /internalReason: reason/);
  assert.doesNotMatch(route, /return apiError\([^;]*reason,\s*422/s);
});
