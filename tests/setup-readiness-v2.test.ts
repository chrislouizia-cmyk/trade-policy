import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_STRATEGY_PROFILE,type StrategyProfile,type StrategyRule} from '../types/trade.ts';
import {appendComposerNode,createComposerCondition,createComposerGroup,strategyRulesFromComposerTree} from '../lib/trading-dna/composer.ts';
import {TRADING_DNA_RULES} from '../lib/trading-dna/registry.ts';
import {buildLiveTradingDnaContext,calculateLiveSetupReadiness,evaluateLiveTradingDna} from '../lib/trading-dna/live-readiness.ts';
import {evaluateTradingDnaRuntime} from '../lib/trading-dna/runtime.ts';

const assessment=(value:boolean,reason='fixture')=>({value,confidence:value?100:0,reason});
const legacy=(ruleKey:string,mandatory=true,weight=10,evaluationMode:StrategyRule['evaluationMode']='AUTOMATIC'):StrategyRule=>({ruleKey,label:ruleKey,enabled:true,mandatory,weight,minimumConfidence:60,timeframeRole:'CONFIRMATION',evaluationMode});
const profile=(rules:StrategyRule[]):StrategyProfile=>({...DEFAULT_STRATEGY_PROFILE,rules});
const run=(rules:StrategyRule[],facts:Record<string,unknown>)=>calculateLiveSetupReadiness(evaluateTradingDnaRuntime(rules,{facts},()=> '2026-01-01T00:00:00.000Z'));

test('live evidence maps detector output to stable Trading DNA registry IDs',()=>{
  const context=buildLiveTradingDnaContext({bosConfirmed:assessment(true),liquiditySweep:assessment(false),retestConfirmed:assessment(true)});
  assert.equal((context.facts['structure.bos'] as any).value,true);assert.equal((context.facts['smart-money.liquidity-sweep'] as any).value,false);assert.equal((context.facts['price-action.retest'] as any).value,true);
  assert.equal(context.facts.bosConfirmed,undefined);
});

test('dna.v1 composer conditions execute during live methodology evaluation',()=>{
  const definition=TRADING_DNA_RULES.find(rule=>rule.id==='structure.bos')!;const condition=createComposerCondition(definition,'live-bos');
  const rules=strategyRulesFromComposerTree(appendComposerNode(createComposerGroup(),'root',condition));
  const result=evaluateLiveTradingDna(profile(rules),{bosConfirmed:assessment(true)});
  assert.equal(result.report.conditions[0].status,'PASS');assert.equal(result.readiness.percentage,100);assert.equal(result.readiness.state,'READY');
});

test('legacy rule IDs use the same normalized runtime evidence',()=>{
  const result=evaluateLiveTradingDna(profile([legacy('bosConfirmed')]),{bosConfirmed:assessment(true)});
  assert.equal(result.report.conditions[0].ruleId,'structure.bos');assert.equal(result.readiness.percentage,100);
});

test('weighted readiness rounds once: one of eight is 13 and two is 25',()=>{
  const rules=['structure.bos','structure.choch','smart-money.liquidity-sweep','smart-money.fair-value-gap','price-action.retest','price-action.strong-rejection','volume.above-average','structure.trend-alignment'].map(id=>legacy(id));
  assert.equal(run(rules,{'structure.bos':true,'structure.choch':false,'smart-money.liquidity-sweep':false,'smart-money.fair-value-gap':false,'price-action.retest':false,'price-action.strong-rejection':false,'volume.above-average':false,'structure.trend-alignment':false}).percentage,13);
  assert.equal(run(rules,{'structure.bos':true,'structure.choch':true,'smart-money.liquidity-sweep':false,'smart-money.fair-value-gap':false,'price-action.retest':false,'price-action.strong-rejection':false,'volume.above-average':false,'structure.trend-alignment':false}).percentage,25);
});

test('optional failures are confluence and do not lower required readiness',()=>{
  const result=run([legacy('structure.bos',true,30),legacy('structure.choch',false,70)],{'structure.bos':true,'structure.choch':false});
  assert.equal(result.percentage,100);assert.deepEqual(result.required,{passed:1,failed:0,pending:0});assert.deepEqual(result.optional,{passed:0,failed:1,pending:0});
});

test('manual external and unavailable automatic required evidence remain pending',()=>{
  const result=run([legacy('risk.stop-placement',true,10,'MANUAL'),legacy('external.economic-calendar',true,10,'EXTERNAL'),legacy('trend.ema',true,10)],{});
  assert.deepEqual(result.required,{passed:0,failed:0,pending:3});assert.equal(result.percentage,0);assert.equal(result.state,'WAITING_FOR_CONFIRMATION');
});

test('required FAIL is NOT READY, all pending waits, all passing is READY',()=>{
  assert.equal(run([legacy('structure.bos')],{'structure.bos':false}).state,'NOT_READY');
  assert.equal(run([legacy('structure.bos')],{}).state,'WAITING_FOR_CONFIRMATION');
  assert.equal(run([legacy('structure.bos')],{'structure.bos':true}).state,'READY');
});

test('no required rules requires configuration rather than returning 100',()=>{const result=run([legacy('structure.bos',false)],{'structure.bos':true});assert.equal(result.percentage,null);assert.equal(result.state,'CONFIGURATION_REQUIRED')});

test('nested ALL and ANY retain runtime group semantics',()=>{
  const bos=createComposerCondition(TRADING_DNA_RULES.find(rule=>rule.id==='structure.bos')!,'bos');const choch=createComposerCondition(TRADING_DNA_RULES.find(rule=>rule.id==='structure.choch')!,'choch');
  let any=createComposerGroup('alternatives','ANY');any=appendComposerNode(any,'alternatives',bos);any=appendComposerNode(any,'alternatives',choch);let root=appendComposerNode(createComposerGroup(),'root',any);
  const rules=strategyRulesFromComposerTree(root),report=evaluateTradingDnaRuntime(rules,{facts:{bos:true,choch:false}});assert.equal(report.status,'PASS');assert.equal(calculateLiveSetupReadiness(report).state,'READY');
  root={...root,children:[{...any,logic:'ALL'}]};assert.equal(evaluateTradingDnaRuntime(strategyRulesFromComposerTree(root),{facts:{bos:true,choch:false}}).status,'FAIL');
});

test('customer readiness uses human labels and never serialized composer keys',()=>{
  const condition=createComposerCondition(TRADING_DNA_RULES.find(rule=>rule.id==='structure.bos')!,'bos');const result=evaluateLiveTradingDna(profile(strategyRulesFromComposerTree(appendComposerNode(createComposerGroup(),'root',condition))),{bosConfirmed:assessment(false)});
  assert.match(result.readiness.blockers[0].label,/BOS/);assert.doesNotMatch(JSON.stringify(result.readiness),/dna\.v1\./);
});

test('required readiness percentages use the required-rule denominator and ignore optional confluence',()=>{
  const result=evaluateLiveTradingDna(profile([
    legacy('bosConfirmed',true,25),
    legacy('liquiditySweep',true,25),
    legacy('retestConfirmed',true,25),
    legacy('fairValueGap',true,25),
    legacy('premiumDiscount',false,50),
  ]),{bosConfirmed:assessment(true),liquiditySweep:assessment(false),retestConfirmed:assessment(false),fairValueGap:assessment(false),premiumDiscount:assessment(true)});
  assert.equal(result.readiness.percentage,25);
  assert.equal(result.readiness.required.passed,1);
  assert.equal(result.readiness.required.failed,3);
  assert.equal(result.readiness.required.pending,0);
  assert.equal(result.readiness.optional.passed,1);
});

test('alias keys normalize to the canonical runtime evidence and resolve readiness',()=>{
  const result=evaluateLiveTradingDna(profile([
    legacy('trendAlignmentH1',true,40),
    legacy('premium_discount',true,30),
    legacy('breakOfStructure',true,30),
  ]),{h1TrendAligned:assessment(true),premiumDiscount:assessment(true),bosConfirmed:assessment(true)});
  assert.equal(result.readiness.percentage,100);
  assert.equal(result.readiness.required.passed,3);
  assert.equal(result.readiness.diagnostics?.unmatchedStrategyRuleKeys.length,0);
});

test('empty evidence produces zero percent with explicit diagnostics',()=>{
  const result=evaluateLiveTradingDna(profile([
    legacy('bosConfirmed',true,100),
    legacy('liquiditySweep',true,100),
  ]),{});
  assert.equal(result.readiness.percentage,0);
  assert.equal(result.readiness.required.passed,0);
  assert.equal(result.readiness.required.failed,0);
  assert.equal(result.readiness.required.pending,2);
  assert.match(result.readiness.diagnostics?.reason ?? '',/no evidence/i);
});

test('unmatched strategy rule keys are surfaced diagnostically',()=>{
  const result=evaluateLiveTradingDna(profile([
    legacy('mysteryDetector',true,100),
  ]),{});
  assert.deepEqual(result.readiness.diagnostics?.unmatchedStrategyRuleKeys, ['mysteryDetector']);
});
