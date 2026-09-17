import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const migration=readFileSync(new URL('../supabase/migrations/20260917233908_marketplace_trade_observation_clock.sql',import.meta.url),'utf8');
const card=readFileSync(new URL('../components/MarketplaceObservationCard.tsx',import.meta.url),'utf8');

test('marketplace surveillance starts from the first real opened trade for the exact revision',()=>{
  assert.match(migration,/select min\(opened_at\),max\(opened_at\)/i);
  assert.match(migration,/strategy_profile_id=p_source_strategy_id/i);
  assert.match(migration,/strategy_revision_id=p_source_strategy_revision_id/i);
  const clock=migration.match(/-- Opening a real recorded trade[\s\S]*?select count\(\*\)::integer/)?.[0]??'';
  assert.doesNotMatch(clock,/decision_reports|backtest_runs|status='CLOSED'/i);
});

test('first trade is day one and the clock advances by elapsed calendar days',()=>{
  assert.match(migration,/alter column observation_started_at drop not null/i);
  assert.match(migration,/when excluded\.observation_started_at is null then null/i);
  assert.match(migration,/greatest\(1,1\+floor\(extract\(epoch from \(now\(\)-v_candidate\.observation_started_at\)\)\/86400\)\)/i);
  assert.match(migration,/observation_started_at is null then 0/i);
});

test('closed trades still drive performance evidence without delaying the observation clock',()=>{
  assert.match(migration,/status='CLOSED' and closed_at is not null and result_r is not null/i);
  assert.match(card,/Starts automatically when you open the first real trade/);
  assert.match(card,/Request listing review/);
  assert.match(card,/progress max="100"/);
});
