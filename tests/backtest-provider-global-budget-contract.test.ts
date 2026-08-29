import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const cache = fs.readFileSync('lib/server/backtest-historical-cache.ts', 'utf8');

test('provider budget is shared through globalThis instead of being request-local only', () => {
  assert.match(cache, /__tradePoliceTwelveDataBudget/);
  assert.match(cache, /providerBudgetState/);
  assert.match(cache, /PROVIDER_WINDOW_MS = 60_000/);
});

test('rolling provider budget blocks the ninth call across concurrent requests', () => {
  assert.match(cache, /providerBudgetState\.calls\.length >= PROVIDER_CALL_BUDGET/);
  assert.match(cache, /reserveProviderCall\(\)/);
  assert.match(cache, /if \(!providerBudget\.allowed\)/);
  assert.match(cache, /retryAfterSeconds: providerBudget\.retryAfterSeconds/);
});

test('existing per-execution eight-call ceiling remains in place', () => {
  assert.match(cache, /if \(requestsUsed >= PROVIDER_CALL_BUDGET\)/);
});

test('cache pagination remains enabled', () => {
  assert.match(cache, /const PAGE_SIZE = 1000/);
  assert.match(cache, /\.range\(from, from \+ PAGE_SIZE - 1\)/);
});
