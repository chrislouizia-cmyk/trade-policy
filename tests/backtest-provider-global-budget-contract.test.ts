import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const cache = fs.readFileSync('lib/server/backtest-historical-cache.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/098_coordinate_twelve_data_credits.sql', 'utf8');

test('provider budget is database-coordinated across all serverless instances', () => {
  assert.doesNotMatch(cache, /__tradePoliceTwelveDataBudget/);
  assert.match(cache, /reserveTwelveDataCredits/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test('atomic provider budget blocks calls beyond the exact minute allowance', () => {
  assert.match(migration, /v_minute_used \+ p_credits <= v_minute_ceiling/);
  assert.match(migration, /p_minute_limit integer default 8/);
  assert.match(cache, /ProviderCreditLimitError/);
  assert.match(cache, /retryAfterSeconds:error\.reservation\.retryAfterSeconds/);
});

test('existing per-execution eight-call ceiling remains in place', () => {
  assert.match(cache, /if \(requestsUsed >= PROVIDER_CALL_BUDGET\)/);
});

test('cache pagination remains enabled', () => {
  assert.match(cache, /const PAGE_SIZE = 1000/);
  assert.match(cache, /\.range\(from, from \+ PAGE_SIZE - 1\)/);
});
