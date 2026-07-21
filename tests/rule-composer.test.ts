import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { StrategyRule } from '../types/trade.ts';
import { TRADING_DNA_RULES } from '../lib/trading-dna/registry.ts';
import { appendComposerNode, composerTreeFromStrategyRules, createComposerCondition, createComposerGroup, deleteComposerNode, duplicateComposerNode, moveComposerNode, strategyRulesFromComposerTree, summarizeComposerTree, updateComposerNode, validateComposerCondition, validateComposerTree, type ComposerCondition } from '../lib/trading-dna/composer.ts';

const component=readFileSync(new URL('../components/RuleComposer.tsx',import.meta.url),'utf8');
const builder=readFileSync(new URL('../components/StrategyBuilder.tsx',import.meta.url),'utf8');
const rule=(id:string)=>{const found=TRADING_DNA_RULES.find(item=>item.id===id);assert.ok(found);return found};

test('condition creation consumes registry defaults and persists through StrategyRule',()=>{
  const condition=createComposerCondition(rule('risk.minimum-rr'),'rr-1');
  condition.operands=[2];
  const tree=appendComposerNode(createComposerGroup(),'root',condition);
  const stored=strategyRulesFromComposerTree(tree);
  assert.equal(stored.length,1);
  assert.match(stored[0].ruleKey,/^dna\.v1\./);
  assert.equal(composerTreeFromStrategyRules(stored).children[0].kind,'CONDITION');
});

test('conditions can be edited without rule-specific mutation code',()=>{
  const condition=createComposerCondition(rule('structure.bos'),'bos-1');
  const tree=appendComposerNode(createComposerGroup(),'root',condition);
  const edited=updateComposerNode(tree,'bos-1',node=>({...node,inputs:{...(node as ComposerCondition).inputs,direction:'BULLISH'}} as ComposerCondition));
  assert.equal((edited.children[0] as ComposerCondition).inputs.direction,'BULLISH');
});

test('conditions support duplication deletion and movement',()=>{
  let tree=appendComposerNode(createComposerGroup(),'root',createComposerCondition(rule('structure.bos'),'a'));
  tree=appendComposerNode(tree,'root',createComposerCondition(rule('structure.choch'),'b'));
  tree=duplicateComposerNode(tree,'a','copy');
  assert.deepEqual(tree.children.map(node=>node.id),['a','copy','b']);
  tree=moveComposerNode(tree,'b',-1);
  assert.deepEqual(tree.children.map(node=>node.id),['a','b','copy']);
  tree=deleteComposerNode(tree,'a');
  assert.deepEqual(tree.children.map(node=>node.id),['b','copy']);
});

test('ALL and ANY groups support nested editable trees and round-trip persistence',()=>{
  let root=createComposerGroup('root','ALL');
  let nested=createComposerGroup('any-1','ANY');
  nested=appendComposerNode(nested,'any-1',createComposerCondition(rule('structure.bos'),'bos'));
  nested=appendComposerNode(nested,'any-1',createComposerCondition(rule('structure.choch'),'choch'));
  root=appendComposerNode(root,'root',nested);
  root=appendComposerNode(root,'root',createComposerCondition(rule('session.london'),'london'));
  const restored=composerTreeFromStrategyRules(strategyRulesFromComposerTree(root));
  assert.equal((restored.children[0] as {logic:string}).logic,'ANY');
  assert.equal((restored.children[0] as {children:unknown[]}).children.length,2);
});

test('incomplete dynamic inputs and operator operands prevent saving',()=>{
  const ema=createComposerCondition(rule('trend.ema'),'ema');
  ema.inputs={};
  assert.ok(validateComposerCondition(ema).some(issue=>issue.message==='Required input is missing'));
  ema.inputs={...rule('trend.ema').defaultValues};
  assert.ok(validateComposerCondition(ema).some(issue=>issue.field==='operands'));
});

test('contradictory directions in one ALL group produce a warning',()=>{
  const bullish={...createComposerCondition(rule('structure.bos'),'bull'),inputs:{...rule('structure.bos').defaultValues,direction:'BULLISH'}};
  const bearish={...createComposerCondition(rule('structure.bos'),'bear'),inputs:{...rule('structure.bos').defaultValues,direction:'BEARISH'}};
  let tree=appendComposerNode(createComposerGroup(),'root',bullish);
  tree=appendComposerNode(tree,'root',bearish);
  assert.ok(validateComposerTree(tree).some(issue=>issue.field==='children'&&issue.message.includes('conflicts')));
});

test('operators and configurable controls are dynamically sourced from metadata',()=>{
  assert.match(component,/getOperatorsForTradingDnaRule\(definition\)/);
  assert.match(component,/definition\.configurableInputs\.map/);
  assert.doesNotMatch(component,/rule\.id===['"]trend\.ema|ruleId===['"]structure\.bos/);
});

test('live summary follows nested tree state',()=>{
  let tree=appendComposerNode(createComposerGroup(),'root',createComposerCondition(rule('structure.bos'),'bos'));
  tree=appendComposerNode(tree,'root',createComposerGroup('alternatives','ANY'));
  const lines=summarizeComposerTree(tree);
  assert.ok(lines.some(line=>line.includes('BOS')));
  assert.ok(lines.some(line=>line.includes('Any of')));
  assert.match(component,/My Trading DNA/);
  assert.match(component,/updates|summarizeComposerTree\(tree\)/);
});

test('legacy StrategyRule rows automatically appear without data loss',()=>{
  const legacy:StrategyRule={ruleKey:'bosConfirmed',label:'Break of Structure',enabled:true,mandatory:true,weight:25,minimumConfidence:70,timeframeRole:'CONFIRMATION',evaluationMode:'AUTOMATIC'};
  const tree=composerTreeFromStrategyRules([legacy]);
  const condition=tree.children[0] as ComposerCondition;
  assert.equal(condition.ruleId,'structure.bos');
  const stored=strategyRulesFromComposerTree(tree)[0];
  assert.equal(stored.ruleKey,'bosConfirmed');
  assert.deepEqual({enabled:stored.enabled,mandatory:stored.mandatory,weight:stored.weight,minimumConfidence:stored.minimumConfidence},{enabled:true,mandatory:true,weight:25,minimumConfidence:70});
});

test('Strategy Builder mounts Rule Composer and persistence uses no new schema',()=>{
  assert.match(builder,/RuleComposer/);
  assert.match(builder,/rules:rules\.map/);
  assert.match(component,/ALL group|ANY group/);
});
