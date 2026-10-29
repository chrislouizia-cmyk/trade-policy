import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const migration=readFileSync(new URL('../supabase/migrations/20260918004003_marketplace_public_store_and_strategy_clock.sql',import.meta.url),'utf8');
const card=readFileSync(new URL('../components/MarketplaceObservationCard.tsx',import.meta.url),'utf8');

test('marketplace surveillance starts from the first real opened trade for the strategy across revisions',()=>{
  assert.match(migration,/select strategy_profile_id, user_id, min\(opened_at\), max\(opened_at\)/i);
  assert.match(migration,/marketplace_strategy_observation_clocks/);
  const clock=migration.match(/select first_trade_at,last_trade_at[\s\S]*?select count\(\*\)::integer into v_backtests/)?.[0]??'';
  assert.match(clock,/where source_strategy_id=p_source_strategy_id/i);
  assert.doesNotMatch(clock,/strategy_revision_id=p_source_strategy_revision_id|decision_reports|backtest_runs|status='CLOSED'/i);
});

test('first trade is day one and the clock advances by elapsed calendar days',()=>{
  assert.match(migration,/greatest\(1,1\+floor\(extract\(epoch from\(now\(\)-v_first_trade_at\)\)\/86400\)\)/i);
  assert.match(migration,/when v_first_trade_at is null then 0/i);
});

test('closed trades still drive performance evidence without delaying the observation clock',()=>{
  assert.match(migration,/status='CLOSED' and closed_at is not null and result_r is not null/i);
  assert.match(card,/Starts automatically when you open the first real trade with this strategy/);
  assert.match(card,/clock continues across later strategy revisions/);
  assert.match(card,/Request listing review/);
  assert.match(card,/progress max="100"/);
});
