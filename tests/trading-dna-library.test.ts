import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TRADING_DNA_CATEGORIES, TRADING_DNA_RULES, getTradingDnaRulesByCategory, searchTradingDnaRules, validateTradingDnaRegistry } from '../lib/trading-dna/registry.ts';
import type { TradingDnaRuleDefinition } from '../lib/trading-dna/types.ts';

const catalog=readFileSync(new URL('../components/TradingDnaLibrary.tsx',import.meta.url),'utf8');
const builder=readFileSync(new URL('../components/StrategyBuilder.tsx',import.meta.url),'utf8');
const ruleBuilder=readFileSync(new URL('../components/RuleBuilder.tsx',import.meta.url),'utf8');

test('registry contains the complete Phase 1 vocabulary with unique IDs',()=>{
  assert.equal(TRADING_DNA_RULES.length,53);
  assert.equal(new Set(TRADING_DNA_RULES.map(rule=>rule.id)).size,53);
  assert.deepEqual(validateTradingDnaRegistry(),[]);
});

test('categories load in the required stable order',()=>{
  assert.deepEqual(TRADING_DNA_CATEGORIES.map(category=>category.displayName),['Trend','Momentum','Market Structure','Smart Money Concepts','Price Action','Volume','Session','Risk','External']);
  assert.deepEqual(TRADING_DNA_CATEGORIES.map(category=>category.order),[1,2,3,4,5,6,7,8,9]);
  assert.ok(TRADING_DNA_CATEGORIES.every(category=>getTradingDnaRulesByCategory(category.id).length>0));
});

test('search matches names, descriptions, tags, and category labels',()=>{
  assert.ok(searchTradingDnaRules('EMA').some(rule=>rule.id==='trend.ema'));
  assert.ok(searchTradingDnaRules('evidence required').length>0);
  assert.ok(searchTradingDnaRules('institutional benchmark').some(rule=>rule.id==='trend.vwap'));
  assert.equal(searchTradingDnaRules('Smart Money').length,10);
  assert.deepEqual(new Set(searchTradingDnaRules('liquidity','SMART_MONEY').map(rule=>rule.id)),new Set(['smart-money.order-block','smart-money.breaker-block','smart-money.mitigation-block','smart-money.fair-value-gap','smart-money.liquidity-sweep','smart-money.equal-high','smart-money.equal-low','smart-money.premium','smart-money.discount']));
});

test('every rule exposes composer-ready metadata and educational documentation',()=>{
  for(const rule of TRADING_DNA_RULES){
    assert.ok(rule.supportedOperators.length,rule.id);
    assert.ok(rule.tags.length,rule.id);
    assert.ok(rule.whatItMeans&&rule.whyTradersUseIt&&rule.typicalUsage,rule.id);
    assert.ok(rule.typicalConfirmations.length&&rule.exampleScenario&&rule.validationRequirements.length,rule.id);
    assert.equal(rule.configurable,rule.requiredInputs.length>0,rule.id);
  }
});

test('metadata validation reports duplicate IDs and required metadata',()=>{
  const duplicate=[TRADING_DNA_RULES[0],TRADING_DNA_RULES[0]];
  assert.ok(validateTradingDnaRegistry(duplicate).some(issue=>issue.message==='Duplicate rule id'));
  const incomplete={...TRADING_DNA_RULES[0],description:'',tags:[]} as TradingDnaRuleDefinition;
  const issues=validateTradingDnaRegistry([incomplete]);
  assert.ok(issues.some(issue=>issue.field==='description'));
  assert.ok(issues.some(issue=>issue.field==='tags'));
});

test('metadata validation rejects unsupported evidence types',()=>{
  const invalid={...TRADING_DNA_RULES[0],evidenceType:'UNKNOWN'} as unknown as TradingDnaRuleDefinition;
  assert.ok(validateTradingDnaRegistry([invalid]).some(issue=>issue.field==='evidenceType'));
});

test('catalog UI is driven by the registry and composer consumes the same registry',()=>{
  assert.match(catalog,/TRADING_DNA_CATEGORIES/);
  assert.match(catalog,/searchTradingDnaRules/);
  assert.match(catalog,/onSelect\(rule\)/);
  assert.doesNotMatch(catalog,/logicalOperator/);
  assert.match(builder,/RuleComposer/);
});

test('legacy playbook rules remain unchanged and compatible',()=>{
  assert.match(ruleBuilder,/\['h4TrendAligned','Trend alignment','TREND'\]/);
  assert.match(ruleBuilder,/\['orderBlock','Order block','CONFIRMATION'\]/);
  assert.match(builder,/evaluation_mode:rule\.evaluationMode\?\?'AUTOMATIC'/);
});
