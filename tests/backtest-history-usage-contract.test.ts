import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const api = fs.readFileSync('app/api/backtests/route.ts', 'utf8');
const server = fs.readFileSync('lib/server/backtesting.ts', 'utf8');
const detail = fs.readFileSync('components/StrategyDetailPage.tsx', 'utf8');
const builder = fs.readFileSync('components/StrategyBuilder.tsx', 'utf8');

test('past runs are owner-scoped and filterable by strategy on the server', () => {
  assert.match(api, /auth\.getUser\(\)/);
  assert.match(api, /searchParams\.get\('strategyProfileId'\)/);
  assert.match(api, /z\.string\(\)\.uuid\(\)/);
  assert.match(api, /eq\('user_id', user\.id\)/);
  assert.match(api, /eq\('strategy_profile_id', strategyProfileId\)/);
  assert.match(api, /Cache-Control': 'no-store'/);
});

test('usage is read from the authoritative credit ledger instead of visible strategy runs', () => {
  assert.match(api, /getBacktestUsageSummaryForUser\(user\.id\)/);
  assert.match(api, /Backtest usage summary could not be loaded/);
  assert.match(server, /from\('backtest_usage'\)/);
  assert.match(server, /from\('backtest_credit_reservations'\)/);
  assert.match(server, /eq\('counts_against_limit', true\)/);
  assert.match(server, /row\.status === 'CONSUMED'/);
  assert.match(server, /row\.status === 'RESERVED'/);
  assert.match(server, /billing_period_start', period\.startKey/);
  assert.doesNotMatch(detail, /runs\.filter\(\(run\) => run\.status === 'COMPLETED'\)/);
});

test('strategy detail reloads history on entry and tab open without presenting false zeroes', () => {
  assert.match(detail, /\/api\/backtests\?strategyProfileId=/);
  assert.match(detail, /async function refreshBacktests\(\)/);
  assert.match(detail, /Loading verified usage/);
  assert.match(detail, /Loading past runs/);
  assert.match(detail, /historyError/);
  assert.match(detail, />Retry</);
  assert.match(builder, /key=\{selectedProfile\.id\}/);
  assert.match(builder, /initialRuns=\{\[\]\}/);
  assert.doesNotMatch(builder, /\.from\('backtest_runs'\)/);
});
