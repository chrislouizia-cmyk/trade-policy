import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildFinalReviewSummary } from '../lib/final-review-summary.ts';
import { DEFAULT_STRATEGY_PROFILE, type StrategyRule, type StrategySession } from '../types/trade.ts';

const builder=readFileSync(new URL('../components/StrategyBuilder.tsx',import.meta.url),'utf8');
const rules:StrategyRule[]=[
  {ruleKey:'bos',label:'Break',enabled:true,mandatory:true,weight:40,minimumConfidence:60,timeframeRole:'CONFIRMATION',evaluationMode:'AUTOMATIC'},
  {ruleKey:'psychology',label:'Psychology',enabled:true,mandatory:true,weight:30,minimumConfidence:60,timeframeRole:'ENTRY',evaluationMode:'MANUAL'},
  {ruleKey:'news',label:'News',enabled:true,mandatory:true,weight:30,minimumConfidence:60,timeframeRole:'ENTRY',evaluationMode:'EXTERNAL'},
];
const sessions:StrategySession[]=[{sessionCode:'LONDON',name:'London',timezone:'Europe/London',startTime:'08:00',endTime:'16:00',days:[1,2,3,4,5],allowOpenOutside:false,allowHoldOutside:true}];

test('final review dynamically summarizes methodology and Trading DNA',()=>{
  const profile={...DEFAULT_STRATEGY_PROFILE,id:undefined,instruments:['XAUUSD'],tradingStyle:'day-trading' as const,minimumRR:2.5,maximumRiskPercent:.5,authorizationScore:80};
  const summary=buildFinalReviewSummary(profile,rules,sessions);
  assert.deepEqual([summary.totalRules,summary.automaticRules,summary.manualRules,summary.externalRules],[3,1,1,1]);
  assert.match(summary.narrative.join(' '),/Gold as a Day Trader/);
  assert.match(summary.narrative.join(' '),/London session/);
  assert.match(summary.narrative.join(' '),/2\.5:1/);
  assert.match(summary.narrative.join(' '),/0\.5%/);
  assert.equal(summary.readiness,'Ready for simulated validation');
});

test('legacy rules remain learned but require a supported enabled rule before live validation',()=>{
  const legacy=[{...rules[0],evaluationMode:undefined,enabled:false}];
  const summary=buildFinalReviewSummary({...DEFAULT_STRATEGY_PROFILE,id:'saved'},legacy,sessions);
  assert.equal(summary.totalRules,1);
  assert.equal(summary.automaticRules,1);
  assert.equal(summary.readiness,'No supported rule is enabled');
  assert.equal(summary.canSimulate,false);
  assert.equal(summary.canSave,false);
  assert.equal(summary.canActivate,false);
});

test('review UI uses human labels and preserves the save action',()=>{
  for(const label of ["Here&apos;s what Trade Police will check",'Trading rules','rules configured','checked by Trade Police','confirmed by you','cannot be verified here','Required readiness','Save strategy','Simulated validation','Activate / live validate'])assert.match(builder,new RegExp(label,'i'));
  assert.match(builder,/onClick=\{\(\) => void save\(\)\}/);
  assert.doesNotMatch(builder,/Methodology rules/);
  assert.doesNotMatch(builder,/>Authorization</);
});

test('review UI explicitly distinguishes simulation, save, and activate eligibility',()=>{
  const now=buildFinalReviewSummary({ ...DEFAULT_STRATEGY_PROFILE, id: undefined, instruments:['XAUUSD'], tradingStyle:'day-trading' as const }, [
    {ruleKey:'bos',label:'Break',enabled:true,mandatory:false,weight:40,minimumConfidence:60,timeframeRole:'CONFIRMATION',evaluationMode:'MANUAL'},
    {ruleKey:'news',label:'News',enabled:true,mandatory:false,weight:30,minimumConfidence:60,timeframeRole:'ENTRY',evaluationMode:'EXTERNAL'},
  ], sessions);
  assert.equal(now.readiness, 'Eligible for simulated validation only');
  assert.equal(now.canSimulate, true);
  assert.equal(now.canSave, false);
  assert.equal(now.canActivate, false);
  assert.match(builder, /Simulated validation/);
  assert.match(builder, /Save strategy/);
  assert.match(builder, /Activate \/ live validate/);
  assert.match(builder, /eligible for simulated validation only/i);
});

test('unsupported custom rules are explicitly called out as ineligible for activation',()=>{
  const unsupported=buildFinalReviewSummary({ ...DEFAULT_STRATEGY_PROFILE, id: undefined, instruments:['XAUUSD'], tradingStyle:'day-trading' as const }, [
    {ruleKey:'latestCompletedCandleCloseMustBeGreaterThanZero',label:'Latest completed candle close must be greater than 0',enabled:true,mandatory:true,weight:20,minimumConfidence:60,timeframeRole:'ENTRY',evaluationMode:'AUTOMATIC'},
  ], sessions);
  assert.equal(unsupported.canSimulate, false);
  assert.equal(unsupported.canSave, false);
  assert.equal(unsupported.canActivate, false);
  assert.equal(unsupported.statusDetail, 'This condition is not supported yet and will not count toward activation.');
});
