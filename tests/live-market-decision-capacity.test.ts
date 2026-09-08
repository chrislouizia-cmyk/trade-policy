import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('the coordinator mirrors a rolling provider minute instead of a calendar-minute reset', () => {
  const migration = read('supabase/migrations/100_protect_daily_live_market_capacity.sql');
  assert.match(migration, /v_now - interval '60 seconds'/);
  assert.match(migration, /sum\(credits\)/);
  assert.match(migration, /allowed is true/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /p_minute_limit-7/);
  assert.match(migration, /p_daily_limit-720/);
});

test('the display chart cannot consume capacity reserved for a live decision', () => {
  const candles = read('app/api/market/candles/route.ts');
  const quote = read('app/api/market/quote/route.ts');
  const hook = read('components/useMarketCandles.ts');
  assert.match(candles, /priority:'BACKGROUND'/);
  assert.match(quote, /priority: 'BACKGROUND'/);
  assert.match(quote, /reserveTwelveDataCredits/);
  assert.match(hook, /case 'M5': return 300_000/);
  assert.match(hook, /case 'H1': return 3_600_000/);
  assert.doesNotMatch(hook, /setInterval[\s\S]*fetchLatestQuote/);
  assert.doesNotMatch(hook, /onWindowActivity[\s\S]*fetchLatestQuote/);
  assert.match(hook, /document\.visibilityState === 'visible'/);
  assert.match(hook, /const activeRange = candleRangeForTimeframe\(timeframe\)/);
});

test('a temporary credit-window collision retries once without exposing provider internals', () => {
  const panel = read('components/LiveMarketPanel.tsx');
  const route = read('app/api/market/analyze/route.ts');
  assert.match(panel, /marketAnalysisRetryDelay/);
  assert.match(panel, /window\.setTimeout\(\(\) => \{[\s\S]*void scan\(1\);[\s\S]*\}, retryDelay \* 1_000\)/);
  assert.match(panel, /Trade Police will continue automatically/);
  assert.match(panel, /Market check needs another moment/);
  assert.doesNotMatch(panel, /No decision was produced/);
  assert.doesNotMatch(route, /provider minute limit|provider credit window/i);
  assert.match(route, /MARKET_DATA_DAILY_REST/);
  assert.match(panel, /requested>65/);
});

test('HQ credit telemetry is recent enough to explain the current rolling window', () => {
  const health = read('app/api/hq/health/route.ts');
  assert.match(health, /Date\.now\(\)-60_000/);
  assert.match(health, /CACHE_MS=10_000/);
  assert.match(health, /rolling minute/);
  assert.match(health, /TWELVE_DATA_DAILY_LIMIT/);
  assert.match(health, /Daily market-data capacity is resting/);
});
