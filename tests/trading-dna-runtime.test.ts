import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { StrategyRule, TradeResult } from '../types/trade.ts';
import { appendComposerNode, createComposerCondition, createComposerGroup, strategyRulesFromComposerTree } from '../lib/trading-dna/composer.ts';
import { TRADING_DNA_RULES } from '../lib/trading-dna/registry.ts';
import { applyTradingDnaRuntime, evaluateTradingDnaOperator, evaluateTradingDnaRuntime } from '../lib/trading-dna/runtime.ts';

const api=readFileSync(new URL('../app/api/validate/route.ts',import.meta.url),'utf8');
const validator=readFileSync(new URL('../components/TradeValidator.tsx',import.meta.url),'utf8');
const view=readFileSync(new URL('../components/TradingDnaEvidenceReport.tsx',import.meta.url),'utf8');
const baseResult:TradeResult={score:90,grade:'A',verdict:'AUTHORIZED',rr:2,riskAmount:10,stopDistance:1,vetoes:[],observations:[],scoreItems:[]};

function executableCondition(ruleId:string,index:number){const rule=TRADING_DNA_RULES.find(item=>item.id===ruleId)!;const condition=createComposerCondition(rule,`condition-${index}`);const op=condition.operator;condition.operands=['BETWEEN','WITHIN','OUTSIDE'].includes(op)?[1,3]:['IS_TRUE','IS_FALSE','EXISTS','MISSING','CONFIRMED','FAILED'].includes(op)?[]:[1];const actual=op==='IS_TRUE'||op==='CONFIRMED'||op==='EXISTS'?true:op==='IS_FALSE'||op==='FAILED'||op==='MISSING'?false:op==='CROSSES_ABOVE'?[0,2]:op==='CROSSES_BELOW'?[2,0]:op==='LESS_THAN'||op==='LESS_THAN_OR_EQUAL'?0:op==='OUTSIDE'?4:op==='CONTAINS'?['x',1]:op==='EXCLUDES'?['x']:2;return {condition,actual};}

test('every Trading DNA registry rule is executable',()=>{
  let tree=createComposerGroup();const facts:Record<string,unknown>={};
  TRADING_DNA_RULES.forEach((rule,index)=>{const fixture=executableCondition(rule.id,index);tree=appendComposerNode(tree,'root',fixture.condition);facts[fixture.condition.id]=fixture.actual});
  const report=evaluateTradingDnaRuntime(strategyRulesFromComposerTree(tree),{facts},()=> '2026-01-01T00:00:00.000Z');
  assert.equal(report.conditions.length,53);
  assert.equal(report.counts.pending,0);
  assert.ok(report.conditions.every(item=>item.reason.length>0));
});

test('operator runtime deterministically covers every operator family',()=>{
  assert.equal(evaluateTradingDnaOperator('GREATER_THAN',3,[2]),true);
  assert.equal(evaluateTradingDnaOperator('NOT_EQUALS','BUY',['SELL']),true);
  assert.equal(evaluateTradingDnaOperator('CROSSES_ABOVE',[1,3],[2]),true);
  assert.equal(evaluateTradingDnaOperator('CONFIRMED','CONFIRMED',[]),true);
  assert.equal(evaluateTradingDnaOperator('BETWEEN',2,[1,3]),true);
  assert.equal(evaluateTradingDnaOperator('CONTAINS',['London'],['London']),true);
});

test('missing evidence is PENDING with a deterministic explanation',()=>{
  const condition=createComposerCondition(TRADING_DNA_RULES.find(rule=>rule.id==='structure.bos')!,'bos');
  const rules=strategyRulesFromComposerTree(appendComposerNode(createComposerGroup(),'root',condition));
  const report=evaluateTradingDnaRuntime(rules,{facts:{}});
  assert.equal(report.status,'PENDING');
  assert.equal(report.conditions[0].status,'PENDING');
  assert.match(report.conditions[0].reason,/has not supplied evidence/);
});

test('ALL fails on one failure while ANY passes on one success',()=>{
  const bos=createComposerCondition(TRADING_DNA_RULES.find(rule=>rule.id==='structure.bos')!,'bos');
  const choch=createComposerCondition(TRADING_DNA_RULES.find(rule=>rule.id==='structure.choch')!,'choch');
  let all=appendComposerNode(createComposerGroup('root','ALL'),'root',bos);all=appendComposerNode(all,'root',choch);
  let any=appendComposerNode(createComposerGroup('root','ANY'),'root',bos);any=appendComposerNode(any,'root',choch);
  const facts={bos:true,choch:false};
  assert.equal(evaluateTradingDnaRuntime(strategyRulesFromComposerTree(all),{facts}).status,'FAIL');
  assert.equal(evaluateTradingDnaRuntime(strategyRulesFromComposerTree(any),{facts}).status,'PASS');
});

test('manual confirmations resolve to PASS FAIL or PENDING',()=>{
  const definition=TRADING_DNA_RULES.find(rule=>rule.id==='risk.stop-placement')!;const condition=createComposerCondition(definition,'stop');let rules=strategyRulesFromComposerTree(appendComposerNode(createComposerGroup(),'root',condition));const key=rules[0].ruleKey;
  const run=(state:'CONFIRMED'|'FAILED'|'PENDING')=>evaluateTradingDnaRuntime(rules,{facts:{},manualConfirmations:[{evidenceKey:key,state}]}).conditions[0].status;
  assert.equal(run('CONFIRMED'),'PASS');assert.equal(run('FAILED'),'FAIL');assert.equal(run('PENDING'),'PENDING');
});

test('runtime feeds failures and pending evidence into the existing verdict',()=>{
  const failed=applyTradingDnaRuntime(baseResult,{status:'FAIL',summary:'',generatedAt:'',counts:{passed:0,failed:1,pending:0},groups:[],conditions:[{id:'x',ruleId:'x',label:'Required rule',status:'FAIL',required:true,evaluationType:'AUTOMATIC',operator:'IS_TRUE',actual:false,expected:[],reason:'Evidence was false.',groupPath:['root']}]});
  assert.equal(failed.verdict,'REJECTED');assert.match(failed.vetoes[0],/Evidence was false/);
  const pending=applyTradingDnaRuntime(baseResult,{status:'PENDING',summary:'',generatedAt:'',counts:{passed:0,failed:0,pending:1},groups:[],conditions:[{id:'x',ruleId:'x',label:'Required rule',status:'PENDING',required:true,evaluationType:'EXTERNAL',operator:'EXISTS',actual:null,expected:[],reason:'Integration pending.',groupPath:['root']}]});
  assert.equal(pending.verdict,'WAIT');
});

test('optional failures remain visible but do not block entry',()=>{
  const rule:StrategyRule={ruleKey:'bosConfirmed',label:'Optional BOS',enabled:true,mandatory:false,weight:10,minimumConfidence:60,timeframeRole:'CONFIRMATION',evaluationMode:'AUTOMATIC'};
  const report=evaluateTradingDnaRuntime([rule],{facts:{'structure.bos':false}});
  assert.equal(report.conditions[0].status,'FAIL');assert.equal(report.conditions[0].required,false);assert.equal(report.status,'PASS');
  assert.equal(applyTradingDnaRuntime(baseResult,report).verdict,'AUTHORIZED');
});

test('validation API returns the runtime report before Decision Narrative generation',()=>{
  assert.match(api,/evaluateTradingDnaRuntime/);assert.match(api,/applyTradingDnaRuntime/);assert.match(api,/evidenceReport/);assert.match(api,/legacyDecisionStrategy/);assert.match(api,/!rule\.ruleKey\.startsWith\('dna\.v1\.'\)/);
  assert.ok(api.indexOf('applyTradingDnaRuntime')<api.indexOf('buildDecisionNarrative({'));
});

test('external rules without integration remain PENDING and never guess',()=>{
  const definition=TRADING_DNA_RULES.find(rule=>rule.id==='external.economic-calendar')!;const condition=createComposerCondition(definition,'calendar');const report=evaluateTradingDnaRuntime(strategyRulesFromComposerTree(appendComposerNode(createComposerGroup(),'root',condition)),{facts:{}});
  assert.equal(report.conditions[0].evaluationType,'EXTERNAL');assert.equal(report.conditions[0].status,'PENDING');assert.equal(report.conditions[0].actual,undefined);
});

test('customer UI exposes explanations but not serialized keys or internal rule IDs',()=>{
  assert.doesNotMatch(view,/>\{condition\.(?:ruleId|id)\}</);
  assert.doesNotMatch(view,/dna\.v1/);
  assert.doesNotMatch(validator,/evidenceReport\.(conditions|groups).*ruleId/);
});

test('complete Evidence Report renders condition and logical-group explanations',()=>{
  assert.match(validator,/TradingDnaEvidenceReportView/);assert.match(view,/Trading DNA Evidence Report/);assert.match(view,/condition\.reason/);assert.match(view,/Logical group evaluation/);assert.match(view,/PASS|Passed/);assert.match(view,/FAIL|Failed/);assert.match(view,/PENDING|Pending/);
});
