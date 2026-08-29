import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const registry=fs.readFileSync('lib/instrument-registry.ts','utf8');
const cache=fs.readFileSync('lib/server/backtest-historical-cache.ts','utf8');
const executor=fs.readFileSync('lib/server/backtest-executor.ts','utf8');
const api=fs.readFileSync('app/api/backtests/route.ts','utf8');
const builder=fs.readFileSync('components/StrategyBuilder.tsx','utf8');
const builder2=fs.readFileSync('components/StrategyBuilderV2.tsx','utf8');
const migration=fs.readFileSync('supabase/migrations/083_expand_backtest_instrument_universe.sql','utf8');

const expected=['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','EURGBP','EURJPY','GBPJPY','EURAUD','GBPAUD','AUDJPY','CADJPY','CHFJPY','XAUUSD','XAGUSD'];

test('canonical registry contains exactly the initial 17 instruments',()=>{
  for(const symbol of expected) assert.ok(registry.includes(`symbol:'${symbol}'`),symbol);
  assert.equal((registry.match(/backtestEnabled:true/g)??[]).length,17);
  assert.ok(!registry.includes("symbol:'NAS100'"));
});
test('historical cache and executor use canonical provider mapping',()=>{
  assert.match(cache,/twelveDataSymbolFor/);
  assert.match(executor,/twelveDataSymbolFor/);
  assert.ok(!cache.includes('currently supports XAUUSD only'));
  assert.ok(!executor.includes('currently supports XAUUSD only'));
});
test('backtest API rejects unsupported or strategy-disabled instruments before run creation',()=>{
  assert.match(api,/isSupportedInstrument\(payload\.instrument\)/);
  assert.match(api,/strategy\.instruments\.includes\(payload\.instrument\)/);
  assert.ok(api.indexOf('isSupportedInstrument(payload.instrument)') < api.indexOf('createBacktestRun({'));
});
test('strategy builders consume canonical supported universe',()=>{
  assert.match(builder,/strategyCatalogInstruments\(\)/);
  assert.match(builder2,/SUPPORTED_INSTRUMENT_SYMBOLS/);
});
test('083 aligns database constraint to canonical 17',()=>{
  for(const symbol of expected) assert.ok(migration.includes(`'${symbol}'`),symbol);
  assert.match(migration,/drop constraint if exists backtest_runs_instrument_check/);
  assert.match(migration,/add constraint backtest_runs_instrument_check/);
});
