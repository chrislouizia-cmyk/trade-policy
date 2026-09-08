import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration=fs.readFileSync('supabase/migrations/098_coordinate_twelve_data_credits.sql','utf8');
const rollingMigration=fs.readFileSync('supabase/migrations/099_align_provider_rolling_credit_window.sql','utf8');
const coordinator=fs.readFileSync('lib/server/provider-credit-coordinator.ts','utf8');
const market=fs.readFileSync('lib/market-data.ts','utf8');
const analyze=fs.readFileSync('app/api/market/analyze/route.ts','utf8');
const reanalyze=fs.readFileSync('app/api/trades/reanalyze/route.ts','utf8');
const backtest=fs.readFileSync('lib/server/backtest-historical-cache.ts','utf8');
const health=fs.readFileSync('app/api/hq/health/route.ts','utf8');

test('provider reservations are atomic, global, UTC-windowed, and service-role only',()=>{
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/date_trunc\('minute', v_now\)/);
  assert.match(migration,/date_trunc\('day', v_now\)/);
  assert.match(migration,/p_minute_limit integer default 8/);
  assert.match(migration,/p_daily_limit integer default 800/);
  assert.doesNotMatch(migration,/allowed_request_uidx|duplicate.*true/);
  assert.match(migration,/revoke all on function[\s\S]*public, anon, authenticated/);
  assert.match(migration,/grant execute on function[\s\S]*service_role/);
});

test('live operations reserve the complete request before parallel provider calls',()=>{
  assert.match(analyze,/credits:timeframes\.length/);
  assert.match(analyze,/priority:'LIVE'/);
  assert.match(analyze,/reserveTwelveDataCredits[\s\S]*Promise\.all\(timeframes\.map/);
  assert.match(reanalyze,/credits:timeframes\.length\+1/);
  assert.match(reanalyze,/credits:timeframes\.length\+1[\s\S]*fetchPrice\(trade\.instrument\)/);
});

test('server entry points pass through the coordinator without contaminating shared market utilities',()=>{
  assert.doesNotMatch(market,/provider-credit-coordinator/);
  assert.match(fs.readFileSync('app/api/market/candles/route.ts','utf8'),/reserveTwelveDataCredits/);
  assert.match(fs.readFileSync('app/api/market/quote/route.ts','utf8'),/reserveTwelveDataCredits/);
  assert.match(fs.readFileSync('app/api/trades/price/route.ts','utf8'),/reserveTwelveDataCredits/);
  assert.match(coordinator,/p_minute_limit:8,p_daily_limit:800/);
});

test('background backtests preserve live capacity and retry without losing the run',()=>{
  assert.match(rollingMigration,/p_priority='BACKGROUND'.*p_minute_limit-6/);
  assert.match(rollingMigration,/p_priority='BACKGROUND'.*p_daily_limit-40/);
  assert.match(rollingMigration,/v_now - interval '60 seconds'/);
  assert.match(backtest,/priority:'BACKGROUND'/);
  assert.match(backtest,/Historical data is paused to preserve live decision capacity/);
});

test('health reads coordinator telemetry without spending a provider credit',()=>{
  assert.doesNotMatch(health,/api\.twelvedata\.com/);
  assert.match(health,/provider_credit_windows/);
  assert.match(health,/rolling minute/);
  assert.match(health,/recentOperations/);
});
