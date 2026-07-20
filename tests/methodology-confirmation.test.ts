import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildStrategyLearningSummary } from '../lib/strategy-learning-summary.ts';
import { DEFAULT_STRATEGY_PROFILE, type StrategyRule } from '../types/trade.ts';

const confirmation=readFileSync(new URL('../components/StrategyLearningConfirmation.tsx',import.meta.url),'utf8');
const builder=readFileSync(new URL('../components/StrategyBuilder.tsx',import.meta.url),'utf8');

const rules:StrategyRule[]=[
  {ruleKey:'bosConfirmed',label:'Break of Structure',enabled:true,mandatory:true,weight:40,minimumConfidence:60,timeframeRole:'CONFIRMATION',evaluationMode:'AUTOMATIC'},
  {ruleKey:'psychology',label:'Psychology Check',enabled:true,mandatory:true,weight:30,minimumConfidence:60,timeframeRole:'ENTRY',evaluationMode:'MANUAL'},
  {ruleKey:'newsFilter',label:'News Calendar',enabled:true,mandatory:true,weight:30,minimumConfidence:60,timeframeRole:'ENTRY',evaluationMode:'EXTERNAL'},
];

test('saved playbook dynamically generates a methodology explanation',()=>{
  const profile={...DEFAULT_STRATEGY_PROFILE,instruments:['XAUUSD'],tradingStyle:'day-trading' as const,maximumRiskPercent:.5,minimumRR:3,trendTimeframe:'H4',confirmationTimeframe:'H1'};
  const summary=buildStrategyLearningSummary(profile,rules);
  assert.match(summary.explanation.join(' '),/day trading trader focused on Gold/);
  assert.match(summary.explanation.join(' '),/Break of Structure/);
  assert.match(summary.explanation.join(' '),/Psychology Check/);
  assert.match(summary.explanation.join(' '),/News Calendar/);
  assert.match(summary.explanation.join(' '),/maximum 0\.5% risk per trade and minimum 1:3/);
});

test('legacy rules without an evaluation mode remain automatic',()=>{
  const legacyRules=[{...rules[0],evaluationMode:undefined}];
  const summary=buildStrategyLearningSummary(DEFAULT_STRATEGY_PROFILE,legacyRules);
  assert.equal(summary.automaticRules.length,1);
  assert.equal(summary.manualRules.length,0);
  assert.equal(summary.externalRules.length,0);
});

test('confirmation UI contains Trading DNA and explicit verification actions',()=>{
  assert.match(confirmation,/Trade Police has learned your methodology\./);
  assert.match(confirmation,/Here&apos;s how I&apos;ll analyze trades for you/);
  for(const label of ['Market(s)','Trading Style','Risk Model','Automatic Rules','Manual Confirmations','External Integrations'])assert.match(confirmation,new RegExp(label.replace(/[()]/g,'\\$&')));
  assert.match(confirmation,/✓ Automatic Understanding/);
  assert.match(confirmation,/✓ Pending External Integrations/);
  assert.match(confirmation,/Yes, that&apos;s exactly how I trade/);
  assert.match(confirmation,/I&apos;d like to make some changes/);
});

test('successful save opens confirmation and edit reopens the editor',()=>{
  assert.match(builder,/setLearningConfirmation\(\{profile:savedProfile,rules:\[\.\.\.rules\]\}\)/);
  assert.match(builder,/onEdit=\{\(\)=>\{[^}]*setLearningConfirmation\(null\);setBuilderStep\('identity'\)\}\}/);
  assert.doesNotMatch(builder,/setMessage\(['"]Saved['"]\)/);
});
