import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLiveAnalysis, MarketAnalysisError, type Candle } from '../lib/market-analysis.ts';
import { DEFAULT_STRATEGY_PROFILE, type StrategyProfile } from '../types/trade.ts';

function candles(slope:number,shock=0):Candle[]{
  const start=Date.now()-39*3_600_000;
  return Array.from({length:40},(_,i)=>{const base=100+i*slope;const close=base+(i===39?shock:0);return {datetime:new Date(start+i*3_600_000).toISOString(),open:base-.2,high:Math.max(base,close)+.5,low:Math.min(base,close)-.5,close,volume:1000+i};});
}
function series(data:Candle[]){return {H4:data,H1:data,M30:data};}
function strategy(overrides:Partial<StrategyProfile>={}):StrategyProfile{return {...DEFAULT_STRATEGY_PROFILE,id:'strategy-a',aiBehavior:{tone:'analytical',strictness:'conservative',confidenceThreshold:75,explainDecisions:true,suggestAlternatives:true,useDisplayName:true},...overrides};}

test('different instruments are independently calculated from their own candles',()=>{
  const s=strategy();
  const results=[buildLiveAnalysis('XAUUSD',s,series(candles(1,15)),'fixture'),buildLiveAnalysis('EURUSD',s,series(candles(-1,-15)),'fixture'),buildLiveAnalysis('GBPUSD',s,series(candles(0)),'fixture')];
  assert.deepEqual(results.map(x=>x.instrument),['XAUUSD','EURUSD','GBPUSD']);
  assert.deepEqual(results.map(x=>x.suggestedDirection),['BUY','SELL',null]);
  assert.equal(results.every(x=>x.components.mandatoryScore+x.components.optionalScore+x.components.alignmentScore+x.components.contradictionPenalty===x.liveAnalysisConfidence),true);
});

test('identical candles score differently for different strategy DNA',()=>{
  const data=series(candles(1,15));
  const continuation=strategy({id:'continuation',requiredEvidence:['h4TrendAligned','h1TrendAligned','bosConfirmed'],evidenceWeights:{...DEFAULT_STRATEGY_PROFILE.evidenceWeights,bosConfirmed:50}});
  const rejection=strategy({id:'rejection',requiredEvidence:['liquiditySweep','chochConfirmed','retestConfirmed'],evidenceWeights:{...DEFAULT_STRATEGY_PROFILE.evidenceWeights,liquiditySweep:50,chochConfirmed:50,retestConfirmed:50}});
  const a=buildLiveAnalysis('XAUUSD',continuation,data,'fixture'); const b=buildLiveAnalysis('XAUUSD',rejection,data,'fixture');
  assert.notEqual(a.liveAnalysisConfidence,b.liveAnalysisConfidence);
  assert.notDeepEqual(a.breakdown.mandatoryMissing,b.breakdown.mandatoryMissing);
});

test('a confirming new candle changes the explainable result and timestamp',async()=>{
  const s=strategy();const before=candles(1);const a=buildLiveAnalysis('XAUUSD',s,series(before),'fixture');
  await new Promise(resolve=>setTimeout(resolve,2));
  const after=[...before,{...before.at(-1)!,datetime:new Date(Date.parse(before.at(-1)!.datetime)+3_600_000).toISOString(),high:160,close:159}];
  const b=buildLiveAnalysis('XAUUSD',s,series(after),'fixture');
  assert.notEqual(a.liveAnalysisConfidence,b.liveAnalysisConfidence);assert.notEqual(a.calculatedAt,b.calculatedAt);assert.notEqual(a.latestCandleTimestamp,b.latestCandleTimestamp);
});

test('provider failure and insufficient candles never become a valid percentage',()=>{
  assert.throws(()=>buildLiveAnalysis('XAUUSD',strategy(),series([]),'fixture'),(error)=>error instanceof MarketAnalysisError&&error.status==='DATA_UNAVAILABLE');
  assert.throws(()=>buildLiveAnalysis('XAUUSD',strategy(),series(candles(1).slice(0,10)),'fixture'),(error)=>error instanceof MarketAnalysisError&&error.status==='INSUFFICIENT_CANDLES');
});

test('live confidence is separate from the strategy threshold',()=>{
  const result=buildLiveAnalysis('XAUUSD',strategy(),series(candles(0)),'fixture');
  assert.equal(result.strategyConfidenceThreshold,75);assert.notEqual(result.liveAnalysisConfidence,result.strategyConfidenceThreshold);
});
