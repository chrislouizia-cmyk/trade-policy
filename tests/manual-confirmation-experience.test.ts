import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyManualRuleSemantics, evaluateRequiredRules, initialManualConfirmations, manualRulePrompt, ruleLabel } from '../lib/manual-confirmations.ts';
import type { StrategyRule } from '../types/trade.ts';

const validator=readFileSync(new URL('../components/TradeValidator.tsx',import.meta.url),'utf8');
const drawer=readFileSync(new URL('../components/ManualConfirmationDrawer.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/trade-police.css',import.meta.url),'utf8');
const narrative=readFileSync(new URL('../lib/intelligence/decision-narrative.ts',import.meta.url),'utf8');
const contract=readFileSync(new URL('../tests/decision-narrative-contract.test.ts',import.meta.url),'utf8');

const required:StrategyRule={ruleKey:'orderBlock',label:'orderBlock',enabled:true,mandatory:true,weight:50,minimumConfidence:60,timeframeRole:'ENTRY',evaluationMode:'MANUAL'};
const optional:StrategyRule={...required,ruleKey:'correlationFilter',label:'correlationFilter',mandatory:false};

test('pending manual rule produces WAIT and failed mandatory manual rule produces BLOCK',()=>{
  assert.equal(applyManualRuleSemantics('AUTHORIZED',[required],[{evidenceKey:'orderBlock',state:'PENDING'}]).verdict,'WAIT');
  assert.equal(applyManualRuleSemantics('AUTHORIZED',[required],[{evidenceKey:'orderBlock',state:'FAILED'}]).verdict,'REJECTED');
});

test('confirmed mandatory rules allow ENTER while optional missing rules do not block',()=>{
  assert.equal(applyManualRuleSemantics('AUTHORIZED',[required,optional],[{evidenceKey:'orderBlock',state:'CONFIRMED'}]).verdict,'AUTHORIZED');
});

test('underlying classifier distinguishes failed automatic rules from unevaluated rules',()=>{
  const automatic={...required,ruleKey:'bosConfirmed',label:'Break of Structure',evaluationMode:'AUTOMATIC' as const};
  const unknown={...automatic,ruleKey:'customRequired',label:'Custom Required'};
  const external={...required,ruleKey:'newsFilter',label:'News Filter',evaluationMode:'EXTERNAL' as const};
  const evaluated=evaluateRequiredRules([automatic,unknown,external],[],{bosConfirmed:false});
  assert.equal(evaluated.find(rule=>rule.ruleKey==='bosConfirmed')?.state,'FAILED');
  assert.equal(evaluated.find(rule=>rule.ruleKey==='customRequired')?.state,'NOT_EVALUATED');
  assert.equal(evaluated.find(rule=>rule.ruleKey==='newsFilter')?.state,'NOT_EVALUATED');
});

test('Unsure remains pending and new analyses start fresh',()=>{
  assert.equal(manualRulePrompt(required).answers.find(answer=>answer.label==='Unsure')?.state,'PENDING');
  assert.deepEqual(initialManualConfirmations([required]),{orderBlock:'PENDING'});
});

test('internal rule identifiers are mapped to customer-facing names',()=>{
  assert.equal(ruleLabel('orderBlock'),'Order Block');
  assert.equal(ruleLabel('sessionRequirement'),'Trading Session');
  assert.equal(ruleLabel('newsFilter'),'News Filter');
  assert.equal(ruleLabel('correlationFilter'),'Market Correlation');
  assert.doesNotMatch(drawer,/>orderBlock<|>sessionRequirement<|>newsFilter<|>correlationFilter</);
});

test('answer changes trigger deterministic reevaluation and not AI advice',()=>{
  assert.match(validator,/updateManualConfirmation/);
  assert.match(validator,/fetch\('\/api\/validate'/);
  assert.match(validator,/setResult\(data\)/);
  assert.doesNotMatch(drawer,/\bAI\b|advice/i);
});

test('desktop drawer and mobile full-screen sheet remain actionable',()=>{
  assert.match(drawer,/manual-confirmation-drawer/);
  assert.match(drawer,/role="dialog"/);
  assert.match(css,/\.manual-confirmation-drawer\{[^}]*height:100dvh/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.manual-confirmation-drawer\{width:100vw/);
  assert.match(css,/safe-area-inset-bottom/);
});

test('Decision Narrative v1 implementation remains frozen',()=>{
  assert.match(narrative,/version: '1'/);
  assert.match(contract,/freezes the complete deterministic narrative contract/);
});
