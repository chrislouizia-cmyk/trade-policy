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

test('legacy rules remain learned and existing playbooks are ready for live analysis',()=>{
  const legacy=[{...rules[0],evaluationMode:undefined,enabled:false}];
  const summary=buildFinalReviewSummary({...DEFAULT_STRATEGY_PROFILE,id:'saved'},legacy,sessions);
  assert.equal(summary.totalRules,1);
  assert.equal(summary.automaticRules,1);
  assert.equal(summary.readiness,'Ready for live analysis');
});

test('review UI uses human labels and preserves the save action',()=>{
  for(const label of ["Here&apos;s what I learned about your methodology",'Trading DNA','Rules Learned','Automatic','Manual','External','Minimum Approval Score','Complete Training','Trading DNA learned'])assert.match(builder,new RegExp(label));
  assert.match(builder,/onClick=\{\(\) => void save\(\)\}/);
  assert.doesNotMatch(builder,/Methodology rules/);
  assert.doesNotMatch(builder,/>Authorization</);
  assert.doesNotMatch(builder,/Save Strategy/);
});
