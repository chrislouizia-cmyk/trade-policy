import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {restoreMarketChartSnapshot,restoreMarketSnapshot,restoreReusableMarketChartSnapshot,type MarketSnapshotRow} from '../lib/market-snapshot.ts';
import {getTradingViewInterval,getTradingViewSymbol} from '../lib/tradingview-reference.ts';

const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const context={strategyId:'strategy-1',strategyRevisionId:'revision-1',instrument:'GBPUSD'};
const analysis={
  strategyId:'strategy-1',instrument:'GBPUSD',status:'VALID_ANALYSIS',analysisStatus:'VALID_ANALYSIS',
  calculatedAt:'2026-09-09T10:01:00Z',
  marketSeries:{H1:[{datetime:'2026-09-09T10:00:00Z',open:1.1,high:1.2,low:1,close:1.15}]},
};
const row:MarketSnapshotRow={id:'scan-1',created_at:'2026-09-09T10:01:00Z',strategy_profile_id:'strategy-1',strategy_revision_id:'revision-1',instrument:'GBPUSD',analysis};

test('a market snapshot restores only an exact strategy revision and instrument',()=>{
  const restored=restoreMarketSnapshot(row,context);
  assert.equal(restored?.analysis.analysisId,'scan-1');
  assert.equal(restored?.snapshotCreatedAt,row.created_at);
  assert.equal(restored?.analysis.marketSeries?.H1.length,1);
  assert.equal(restoreMarketSnapshot(row,{...context,strategyRevisionId:'revision-2'}),null);
  assert.equal(restoreMarketSnapshot(row,{...context,instrument:'EURUSD'}),null);
});

test('a legacy valid scan can restore its decision while TradingView supplies its missing candles',()=>{
  assert.equal(restoreMarketSnapshot({...row,analysis:{...analysis,marketSeries:undefined}},context)?.analysis.analysisId,'scan-1');
  assert.equal(restoreMarketChartSnapshot({...row,analysis:{...analysis,marketSeries:undefined}},context),null);
});

test('chart restoration strips decision semantics and returns only reusable market data',()=>{
  const restored=restoreMarketChartSnapshot(row,context);
  assert.deepEqual(Object.keys(restored?.chart??{}).sort(),['analysisId','calculatedAt','instrument','marketSeries','provider']);
  assert.equal(restored?.chart.marketSeries?.H1.length,1);
  assert.equal('status' in (restored?.chart??{}),false);
  assert.equal('setupReadiness' in (restored?.chart??{}),false);
});

test('saved candle data is reusable across strategy revisions without restoring their decisions',()=>{
  const reusable=restoreReusableMarketChartSnapshot(row,'GBPUSD');
  assert.equal(reusable?.chart.analysisId,'scan-1');
  assert.equal(reusable?.chart.marketSeries?.H1.length,1);
  assert.equal(restoreReusableMarketChartSnapshot(row,'EURUSD'),null);
});

test('an incomplete or internally mismatched scan fails closed',()=>{
  const {analysisStatus:_,...incomplete}=analysis;
  assert.equal(restoreMarketSnapshot({...row,analysis:incomplete},context),null);
  assert.equal(restoreMarketSnapshot({...row,analysis:{...analysis,instrument:'EURUSD'}},context),null);
  assert.equal(restoreMarketSnapshot({...row,analysis:{...analysis,status:'UNKNOWN'}},context),null);
});

test('the immediate reference chart maps supported markets without using the app market API',()=>{
  assert.equal(getTradingViewSymbol('GBPUSD'),'OANDA:GBPUSD');
  assert.equal(getTradingViewSymbol('XAUUSD'),'OANDA:XAUUSD');
  assert.equal(getTradingViewSymbol('NQ'),'CME_MINI:NQ1!');
  assert.equal(getTradingViewInterval('M15'),'15');
  assert.equal(getTradingViewInterval('H4'),'240');
  const component=read('components/TradingViewReferenceChart.tsx');
  assert.match(component,/s\.tradingview\.com\/widgetembed/);
  assert.match(component,/Visual market view/);
  assert.doesNotMatch(component,/\/api\/market|Twelve Data|useMarketCandles/);
});

test('snapshot restoration is read-only, user-and-instrument scoped and provider-free',()=>{
  const route=read('app/api/market/snapshot/route.ts');
  for(const filter of ["eq('user_id',user.id)","eq('instrument',instrument)"])assert.match(route,new RegExp(filter.replace(/[()'.]/g,'\\$&')));
  assert.doesNotMatch(route,/eq\('strategy_profile_id'|eq\('strategy_revision_id'/);
  assert.match(route,/restoreReusableMarketChartSnapshot/);
  assert.match(route,/Cache-Control':'private, no-store/);
  assert.doesNotMatch(route,/fetchSeries|withTwelveDataCredits|reserveAnalysis|\.insert\(|\.update\(|\.delete\(/);
});

test('explicit analyses persist the same reusable candle series returned to the client',()=>{
  const route=read('app/api/market/analyze/route.ts');
  assert.match(route,/persistedAnalysis = \{\.\.\.enrichedAnalysis,marketSeries:series\}/);
  assert.match(route,/analysis: persistedAnalysis/);
  assert.match(route,/\.\.\.persistedAnalysis,analysisId:scan\.id/);
});

test('Decision opens with cached candles without restoring a stale decision',()=>{
  const panel=read('components/LiveMarketPanel.tsx');
  assert.match(panel,/TradingViewReferenceChart/);
  assert.match(panel,/\/api\/market\/snapshot\?/);
  assert.match(panel,/Saved market data/);
  assert.match(panel,/setChartData\(snapshot\.chart\)/);
  assert.doesNotMatch(panel,/onApplyRef\.current\(snapshot\.analysis\)/);
  assert.match(panel,/analysisSource==='LIVE' \? decisionContent : null/);
  assert.match(panel,/snapshotControllerRef\.current\?\.abort\(\)/);
  assert.doesNotMatch(panel,/snapshot[\s\S]{0,300}void scan\(/);
  assert.doesNotMatch(panel,/setAnalysis\(null\);\s*if \(retryAttempt/);
  assert.match(panel,/MINIMUM_DECISION_CHART_CANDLES=25/);
  assert.match(panel,/hasCompleteChartSeries/);
});

test('BLOCKED presentation keeps the verdict and explanation in independent responsive rows',()=>{
  const css=read('app/trade-police.css');
  assert.match(css,/\.decision-explanation-hero\.state-blocked \.decision-hero-primary\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/state-blocked \.decision-hero-verdict-column,[^}]*state-blocked \.decision-hero-explanation-column\{grid-column:1;min-width:0\}/);
  assert.match(css,/state-blocked \.decision-panel-metrics\{grid-template-columns:repeat\(auto-fit,minmax\(120px,1fr\)\)\}/);
  assert.match(css,/@media\(max-width:1100px\)[\s\S]{0,500}\.decision-explanation-hero \.decision-hero-primary\{grid-template-columns:minmax\(0,1fr\)\}/);
});
