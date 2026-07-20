import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildMethodologyAudit } from '../lib/methodology-audit.ts';
import type { StrategyRule } from '../types/trade.ts';

const component=readFileSync(new URL('../components/MethodologyAudit.tsx',import.meta.url),'utf8');
const validator=readFileSync(new URL('../components/TradeValidator.tsx',import.meta.url),'utf8');

const rules:StrategyRule[]=[
  {ruleKey:'bosConfirmed',label:'Break of Structure',enabled:true,mandatory:true,weight:40,minimumConfidence:60,timeframeRole:'CONFIRMATION',evaluationMode:'AUTOMATIC'},
  {ruleKey:'liquiditySweep',label:'Liquidity Sweep',enabled:true,mandatory:false,weight:20,minimumConfidence:60,timeframeRole:'ENTRY',evaluationMode:'AUTOMATIC'},
  {ruleKey:'psychology',label:'Psychology Check',enabled:true,mandatory:true,weight:20,minimumConfidence:60,timeframeRole:'ENTRY',evaluationMode:'MANUAL'},
  {ruleKey:'newsFilter',label:'News Filter',enabled:true,mandatory:true,weight:20,minimumConfidence:60,timeframeRole:'ENTRY',evaluationMode:'EXTERNAL'},
];

test('methodology audit separates sources and reports only passed failed or not evaluated',()=>{
  const audit=buildMethodologyAudit(rules,{manualConfirmations:[{evidenceKey:'psychology',confirmed:true}]},{evidence:{bosConfirmed:{value:true},liquiditySweep:{value:false}}} as any);
  assert.equal(audit.automatic[0].status,'PASSED');
  assert.equal(audit.automatic[1].status,'FAILED');
  assert.equal(audit.manual[0].status,'PASSED');
  assert.equal(audit.manual[0].detail,'Confirmed by user');
  assert.equal(audit.external[0].status,'NOT_EVALUATED');
  assert.equal(audit.external[0].detail,'Pending integration');
});

test('unknown automatic and unconfirmed manual rules are visibly not evaluated',()=>{
  const audit=buildMethodologyAudit([{...rules[0],ruleKey:'customAutomatic'},{...rules[2],ruleKey:'customManual'}],{},null);
  assert.equal(audit.automatic[0].status,'NOT_EVALUATED');
  assert.equal(audit.manual[0].status,'NOT_EVALUATED');
});

test('completed analyses render Methodology Applied and collapsible Decision Evidence',()=>{
  assert.match(validator,/narrative&&lastAnalysisInput&&<MethodologyAudit/);
  assert.match(component,/Methodology Applied/);
  assert.match(component,/<AuditGroup title="Automatic"/);
  assert.match(component,/<AuditGroup title="Manual"/);
  assert.match(component,/<AuditGroup title="External"/);
  assert.match(component,/<details className="decision-evidence">/);
  assert.match(component,/<summary>Decision Evidence<\/summary>/);
});

test('decision evidence reuses Narrative output without AI reasoning',()=>{
  assert.match(component,/narrative\.recommendation/);
  assert.match(component,/narrative\.explanation/);
  assert.match(component,/narrative\.reasons/);
  assert.doesNotMatch(component,/aiCommentary|educationalExplanation|coachingMessage|learningTip|chain.of.thought/i);
});
