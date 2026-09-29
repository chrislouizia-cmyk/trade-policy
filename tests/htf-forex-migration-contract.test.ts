import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql=readFileSync(new URL('../supabase/migrations/20260929071000_expand_gbpusd_to_forex_htf_strategy.sql',import.meta.url),'utf8');

test('GBPUSD strategy expands in place into the planned four-instrument Forex strategy',()=>{
  assert.match(sql,/name = 'Forex HTF Liquidity & Structure v1'/);
  assert.match(sql,/array\['GBPUSD','EURUSD','GBPJPY','USDJPY'\]/);
  for(const symbol of ['GBPUSD','EURUSD','GBPJPY','USDJPY'])assert.match(sql,new RegExp(`'${symbol}','FOREX'`));
});

test('Forex stop limits preserve JPY pip handling without touching immutable records',()=>{
  assert.match(sql,/'GBPJPY','PIPS',15,35,60/);
  assert.match(sql,/'USDJPY','PIPS',10,30,50/);
  assert.doesNotMatch(sql,/(delete|update|insert into)\s+public\.(decision_reports|active_trades|trade_records|backtest_runs|backtest_trades)/i);
});
