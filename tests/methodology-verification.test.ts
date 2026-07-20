import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildMethodologyVerification } from '../lib/methodology-verification.ts';
import { DEFAULT_STRATEGY_PROFILE, type StrategyRule } from '../types/trade.ts';

const builder=readFileSync(new URL('../components/StrategyBuilder.tsx',import.meta.url),'utf8');
const component=readFileSync(new URL('../components/MethodologyVerification.tsx',import.meta.url),'utf8');
const engine=readFileSync(new URL('../lib/methodology-verification.ts',import.meta.url),'utf8');
const ruleBuilder=readFileSync(new URL('../components/RuleBuilder.tsx',import.meta.url),'utf8');

const rules:StrategyRule[]=[{ruleKey:'bosConfirmed',label:'Break of Structure',enabled:true,mandatory:true,weight:100,minimumConfidence:60,timeframeRole:'CONFIRMATION',evaluationMode:'AUTOMATIC'}];

test('scenario is generated from the playbook and evaluated by Decision Narrative v1',()=>{
  const profile={...DEFAULT_STRATEGY_PROFILE,instruments:['XAUUSD'],allowedSessions:['LONDON'],minimumRR:2.6,requiredEvidence:['bosConfirmed' as const],rules};
  const verification=buildMethodologyVerification(profile,rules);
  assert.equal(verification.scenario.find(item=>item.label==='Market')?.value,'Gold');
  assert.equal(verification.scenario.find(item=>item.label==='Session')?.value,'LONDON');
  assert.equal(verification.scenario.find(item=>item.label==='Risk Reward')?.value,'2.8');
  assert.equal(verification.narrative.version,'1');
  assert.equal(verification.narrative.source,'DETERMINISTIC');
  assert.equal(verification.displayVerdict,'APPROVE');
});

test('verification reuses deterministic engines and contains no AI advice path',()=>{
  assert.match(engine,/validateTrade\(input\)/);
  assert.match(engine,/buildDecisionNarrative/);
  assert.doesNotMatch(engine,/fetch\(|OPENAI|enhanceDecisionNarrative/);
  assert.match(component,/According to the methodology you taught me/);
  assert.match(component,/Would you have taken this trade\?/);
});

test('yes completes onboarding while no launches a save-and-repeat refinement loop',()=>{
  assert.match(builder,/onAccept=.*window\.location\.assign\('\/validate'\)/);
  assert.match(builder,/What did I miss\?/);
  assert.match(builder,/setRefinementRequested\(true\)/);
  assert.match(builder,/if\(refinementRequested\).*setVerification/);
});

test('refinement can add confirmations and edit existing rule controls',()=>{
  assert.match(ruleBuilder,/Add a missing confirmation/);
  assert.match(ruleBuilder,/Add confirmation/);
  assert.match(ruleBuilder,/minimumConfidence/);
  assert.match(ruleBuilder,/evaluationMode/);
});
