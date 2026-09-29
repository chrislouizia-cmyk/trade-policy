import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql=readFileSync(new URL('../supabase/migrations/20260929070000_normalize_gold_htf_strategy.sql',import.meta.url),'utf8');

test('Gold HTF migration adds required displacement and correct timeframe roles',()=>{
  assert.match(sql,/Gold HTF Liquidity Expansion v1/i);
  assert.match(sql,/'displacement','Displacement',true,true/);
  assert.match(sql,/entry_timeframe = 'M15'/);
  assert.match(sql,/trigger_timeframe = 'M5'/);
  assert.match(sql,/'displacement','requirement','REQUIRED','timeframe','M15'/);
});

test('Gold HTF migration enforces intended stop geometry without replacing history',()=>{
  assert.match(sql,/'XAUUSD','POINTS',1200,2400,3600/);
  assert.match(sql,/market_types = array\['METALS'\]/);
  assert.doesNotMatch(sql,/delete\s+from\s+public\.(trade_records|decision_reports|backtest_runs)/i);
});
