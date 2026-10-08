import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql=readFileSync(new URL('../supabase/migrations/20260927000000_normalize_gbpusd_htf_strategy.sql',import.meta.url),'utf8');

test('GBPUSD HTF repair is in-place and does not rewrite immutable history or backtests',()=>{
  assert.match(sql,/where name = 'GBPUSD HTF Liquidity & Structure v1'/);
  assert.match(sql,/v_strategy_id,v_user_id,'displacement','Displacement',true,true,10,72,'ENTRY','AUTOMATIC'/);
  assert.match(sql,/entry_timeframe = 'M15'[\s\S]*trigger_timeframe = 'M5'/);
  assert.match(sql,/minimum_value=10,preferred_value=30,maximum_value=50/);
  assert.match(sql,/delete from public\.strategy_rules[\s\S]*market-structure-shift[\s\S]*custom-rule/);
  assert.doesNotMatch(sql,/(delete|update|insert into)\s+public\.(decision_reports|active_trades|trade_records|backtest_runs|backtest_trades)/i);
});
