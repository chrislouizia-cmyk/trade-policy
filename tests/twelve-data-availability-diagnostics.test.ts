import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {isTwelveDataRateLimit} from '../lib/market-data.ts';
const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');

test('Twelve Data minute-credit exhaustion is identified instead of reported as an outage',()=>{
  assert.equal(isTwelveDataRateLimit(200,'You have run out of API credits for the current minute'),true);
  assert.equal(isTwelveDataRateLimit(429,'Too many requests'),true);
  assert.equal(isTwelveDataRateLimit(500,'Internal provider failure'),false);
  const route=read('app/api/market/analyze/route.ts');
  assert.match(route,/MARKET_DATA_RATE_LIMITED/);assert.match(route,/retryAfterSeconds/);
});

test('HQ provider health consumes no credits and exposes coordinated usage',()=>{
  const health=read('app/api/hq/health/route.ts');
  assert.match(health,/CACHE_MS=10_000/);
  assert.doesNotMatch(health,/api\.twelvedata\.com/);
  assert.match(health,/provider_credit_windows/);
  assert.match(health,/provider_credit_events/);
  assert.match(health,/Date\.now\(\)-60_000/);
  assert.match(health,/rolling minute/);
  assert.match(health,/minuteUsed.*minuteLimit.*dailyUsed.*dailyLimit/);
  assert.match(health,/message:services\.twelveData\.message/);
});
