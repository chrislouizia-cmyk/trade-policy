import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHistoricalRulePlan } from '../lib/backtesting/historical-rule-plan.ts';
import { evaluateBacktestRiskGeometry } from '../lib/backtesting/risk-geometry.ts';
import { buildHtfLiquidityStrategy, FOREX_HTF_INSTRUMENTS, FOREX_HTF_STRATEGY_NAME, GOLD_HTF_STRATEGY_NAME } from '../lib/htf-strategy-definitions.ts';
import { buildLiveTradingDnaContext, calculateLiveSetupReadiness } from '../lib/trading-dna/live-readiness.ts';
import { evaluateTradingDnaRuntime } from '../lib/trading-dna/runtime.ts';
import { DEFAULT_STRATEGY_PROFILE } from '../types/trade.ts';

const gbp=()=>buildHtfLiquidityStrategy({...DEFAULT_STRATEGY_PROFILE,name:'existing',instruments:['GBPUSD'],allowedSessions:['LONDON','NEW_YORK']},FOREX_HTF_INSTRUMENTS);

test('current GBPUSD HTF normalization persists the intended rules and removes duplicate/no-op rules',()=>{
  const persisted=gbp();
  const byKey=new Map(persisted.rules.map((rule)=>[rule.ruleKey,rule]));
  for(const key of ['trend-alignment','liquidity-sweep','displacement','choch','bos','retest']){
    assert.equal(byKey.get(key)?.mandatory,true,key);
    assert.equal(byKey.get(key)?.evaluationMode,'AUTOMATIC',key);
  }
  assert.equal(byKey.has('market-structure-shift'),false);
  assert.equal(byKey.has('custom-rule'),false);
  for(const key of ['fair-value-gap','order-block','engulfing','premium-discount','session-open','pullback-entry','liquidity-run'])assert.equal(byKey.get(key)?.mandatory,false,key);
  assert.equal(persisted.profile.requireTrendAlignment,true);
});

test('D1 H4 H1 M15 M5 roles persist beneath the summary',()=>{
  const persisted=gbp();
  assert.deepEqual([
    persisted.profile.macroTimeframe,persisted.profile.trendTimeframe,persisted.profile.confirmationTimeframe,persisted.profile.entryTimeframe,persisted.profile.triggerTimeframe,
  ],['D1','H4','H1','M15','M5']);
  const roles=Object.fromEntries(persisted.rules.map((rule)=>[rule.ruleKey,rule.timeframeRole]));
  assert.equal(roles['trend-alignment'],'CONFIRMATION');
  assert.equal(roles['liquidity-sweep'],'CONFIRMATION');
  assert.equal(roles.displacement,'ENTRY');
  assert.equal(roles.engulfing,'TRIGGER');
  assert.equal(persisted.rules.filter((rule)=>rule.mandatory&&rule.timeframeRole==='TRIGGER').length,0);
});

test('a failed required displacement is a hard gate and optional confluence cannot rescue it',()=>{
  const persisted=gbp();
  const context=buildLiveTradingDnaContext({
    liquiditySweep:{value:true,confidence:100,reason:'pass'},displacement:{value:false,confidence:0,reason:'fail'},chochConfirmed:{value:true,confidence:100,reason:'pass'},bosConfirmed:{value:true,confidence:100,reason:'pass'},retestConfirmed:{value:true,confidence:100,reason:'pass'},
    fairValueGap:{value:true,confidence:100,reason:'optional pass'},premiumDiscount:{value:true,confidence:100,reason:'optional pass'},
  });
  const report=evaluateTradingDnaRuntime(persisted.rules,context,()=> '2026-09-27T00:00:00.000Z');
  const readiness=calculateLiveSetupReadiness(report);
  assert.equal(report.conditions.find((item)=>item.ruleId==='smart-money.displacement')?.required,true);
  assert.equal(readiness.state,'NOT_READY');
  assert.equal(readiness.required.failed,1);
});

test('failed HTF context is a hard gate even when every optional rule passes',()=>{
  const persisted=gbp();
  const context=buildLiveTradingDnaContext({
    h4TrendAligned:{value:true,confidence:100,reason:'H4 pass'},h1TrendAligned:{value:false,confidence:0,reason:'H1 conflict'},
    liquiditySweep:{value:true,confidence:100,reason:'pass'},displacement:{value:true,confidence:100,reason:'pass'},chochConfirmed:{value:true,confidence:100,reason:'pass'},bosConfirmed:{value:true,confidence:100,reason:'pass'},retestConfirmed:{value:true,confidence:100,reason:'pass'},
    fairValueGap:{value:true,confidence:100,reason:'optional pass'},premiumDiscount:{value:true,confidence:100,reason:'optional pass'},
  });
  const report=evaluateTradingDnaRuntime(persisted.rules,context,()=> '2026-09-27T00:00:00.000Z');
  const readiness=calculateLiveSetupReadiness(report);
  assert.equal(report.conditions.find((item)=>item.ruleId==='structure.trend-alignment')?.required,true);
  assert.equal(readiness.state,'NOT_READY');
  assert.equal(readiness.required.failed,1);
});

test('historical plan and frozen JSON shape preserve displacement and corrected timeframe roles',()=>{
  const persisted=gbp();
  const plan=buildHistoricalRulePlan(persisted.profile);
  assert.equal(plan.unsupportedRequiredRules.length,0);
  const displacement=plan.rules.find((rule)=>rule.originalRuleKey==='displacement');
  const htfContext=plan.rules.find((rule)=>rule.originalRuleKey==='trend-alignment');
  assert.equal(htfContext?.detectorId,'market-structure.trend-alignment');
  assert.equal(htfContext?.required,true);
  assert.deepEqual(htfContext?.timeframes,['H4','H1']);
  assert.equal(displacement?.detectorId,'price-action.displacement');
  assert.equal(displacement?.required,true);
  assert.equal(displacement?.timeframe,'M15');
  const snapshot=JSON.parse(JSON.stringify({...persisted.profile,historicalRulePlan:plan}));
  assert.equal(snapshot.historicalRulePlan.rules.find((rule:{originalRuleKey:string})=>rule.originalRuleKey==='displacement').required,true);
  assert.equal(snapshot.entryTimeframe,'M15');
  assert.equal(snapshot.triggerTimeframe,'M5');
});

test('stop geometry and minimum RR are deterministic for GBPUSD, GBPJPY, and Gold',()=>{
  const gbpProfile=gbp().profile;
  assert.equal(evaluateBacktestRiskGeometry(gbpProfile,'GBPUSD',1.3,1.2995,1.301).reason,'STOP_BELOW_MINIMUM');
  assert.equal(evaluateBacktestRiskGeometry(gbpProfile,'GBPUSD',1.3,1.298,1.304).passed,true);
  assert.equal(evaluateBacktestRiskGeometry(gbpProfile,'GBPUSD',1.3,1.294,1.312).reason,'STOP_ABOVE_MAXIMUM');
  assert.equal(evaluateBacktestRiskGeometry(gbpProfile,'GBPUSD',1.3,1.298,1.303).reason,'RR_BELOW_MINIMUM');
  assert.equal(gbp().profile.name,FOREX_HTF_STRATEGY_NAME);
  assert.deepEqual(gbp().profile.instruments,[...FOREX_HTF_INSTRUMENTS]);
  const jpy=buildHtfLiquidityStrategy({...DEFAULT_STRATEGY_PROFILE,name:'JPY',allowedSessions:['LONDON']},['GBPJPY']).profile;
  assert.equal(evaluateBacktestRiskGeometry(jpy,'GBPJPY',190,189.8,190.4).passed,true);
  const gold=buildHtfLiquidityStrategy({...DEFAULT_STRATEGY_PROFILE,name:'Gold',allowedSessions:['LONDON']},['XAUUSD']).profile;
  assert.equal(gold.name,GOLD_HTF_STRATEGY_NAME);
  assert.equal(evaluateBacktestRiskGeometry(gold,'XAUUSD',2500,2488,2524).passed,true);
  assert.equal(evaluateBacktestRiskGeometry(gold,'XAUUSD',2500,2495,2510).reason,'STOP_BELOW_MINIMUM');
});
