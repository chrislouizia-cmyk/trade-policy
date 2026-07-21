import assert from 'node:assert/strict';
import test from 'node:test';
import { TRADING_DNA_OPERATORS } from '../lib/trading-dna/operators.ts';
import { TRADING_DNA_RULES, getOperatorsForTradingDnaRule, searchTradingDnaRules, validateTradingDnaCondition, validateTradingDnaRegistry, validateTradingDnaRuleInputs } from '../lib/trading-dna/registry.ts';

const byId=(id:string)=>{
  const rule=TRADING_DNA_RULES.find(candidate=>candidate.id===id);
  assert.ok(rule,`Missing fixture ${id}`);
  return rule;
};

test('all 53 rules expose complete Phase 2 intelligence metadata',()=>{
  assert.equal(TRADING_DNA_RULES.length,53);
  for(const rule of TRADING_DNA_RULES){
    assert.ok(rule.shortName&&rule.validationSchema&&rule.exampleConditions.length,rule.id);
    assert.ok(Array.isArray(rule.supportedTimeframes)&&Array.isArray(rule.aliases),rule.id);
    assert.ok(Array.isArray(rule.incompatibleRules)&&Array.isArray(rule.complementaryRules),rule.id);
    assert.ok(rule.documentation.whatItMeasures&&rule.documentation.whyTradersUseIt,rule.id);
    assert.ok(rule.documentation.typicalConfirmationSequence.length&&rule.documentation.commonMistakes.length,rule.id);
    assert.ok(rule.educationalNotes.length,rule.id);
  }
  assert.deepEqual(validateTradingDnaRegistry(),[]);
});

test('operator registry covers comparison boolean crossover state range and list families',()=>{
  assert.deepEqual(new Set(TRADING_DNA_OPERATORS.map(operator=>operator.group)),new Set(['COMPARISON','BOOLEAN','CROSSOVER','STATE','RANGE','LIST']));
  for(const symbol of ['>','<','>=','<=','=','!='])assert.ok(TRADING_DNA_OPERATORS.some(operator=>operator.symbol===symbol));
  for(const id of ['IS_TRUE','IS_FALSE','CROSSES_ABOVE','CROSSES_BELOW','EXISTS','MISSING','CONFIRMED','FAILED','BETWEEN','OUTSIDE','CONTAINS','EXCLUDES'])assert.ok(TRADING_DNA_OPERATORS.some(operator=>operator.id===id));
});

test('rule operator choices resolve entirely from reusable definitions',()=>{
  const ema=byId('trend.ema');
  assert.deepEqual(getOperatorsForTradingDnaRule(ema).map(operator=>operator.id),ema.supportedOperators);
  assert.ok(validateTradingDnaCondition(ema,'CONTAINS',ema.defaultValues).some(issue=>issue.field==='operator'));
  assert.deepEqual(validateTradingDnaCondition(ema,'GREATER_THAN',ema.defaultValues),[]);
});

test('representative inputs define controls defaults allowed values and validation',()=>{
  assert.deepEqual(byId('trend.ema').configurableInputs.map(input=>input.key),['period','source','timeframe']);
  assert.deepEqual(byId('momentum.rsi').configurableInputs.map(input=>input.key),['period','threshold','timeframe']);
  assert.ok(byId('structure.bos').configurableInputs.some(input=>input.key==='direction'));
  assert.ok(byId('smart-money.fair-value-gap').configurableInputs.some(input=>input.key==='mitigationRequired'));
  assert.equal(byId('session.london').configurableInputs[0].key,'session');
  assert.equal(byId('risk.minimum-rr').configurableInputs[0].key,'minimumRR');
});

test('input validation rejects missing invalid and unknown values',()=>{
  const ema=byId('trend.ema');
  assert.ok(validateTradingDnaRuleInputs(ema,{}).some(issue=>issue.message==='Required input is missing'));
  assert.ok(validateTradingDnaRuleInputs(ema,{...ema.defaultValues,period:0}).some(issue=>issue.field==='period'));
  assert.ok(validateTradingDnaRuleInputs(ema,{...ema.defaultValues,source:'moon'}).some(issue=>issue.message==='Value is not allowed'));
  assert.ok(validateTradingDnaRuleInputs(ema,{...ema.defaultValues,surprise:true}).some(issue=>issue.message==='Unknown input'));
});

test('aliases resolve common trader vocabulary and rank exact aliases first',()=>{
  assert.equal(searchTradingDnaRules('OB')[0].id,'smart-money.order-block');
  assert.equal(searchTradingDnaRules('Orderblock')[0].id,'smart-money.order-block');
  assert.equal(searchTradingDnaRules('Liquidity Grab')[0].id,'smart-money.liquidity-sweep');
  assert.equal(searchTradingDnaRules('FVG')[0].id,'smart-money.fair-value-gap');
});

test('complementary relationships capture common confirmation sequences',()=>{
  assert.ok(byId('trend.ema').complementaryRules.includes('structure.trend-alignment'));
  assert.ok(byId('smart-money.order-block').complementaryRules.includes('smart-money.fair-value-gap'));
  assert.ok(byId('structure.bos').complementaryRules.includes('structure.choch'));
  assert.ok(byId('price-action.strong-rejection').complementaryRules.includes('volume.spike'));
});

test('incompatible relationships prevent contradictory pairings',()=>{
  assert.ok(byId('smart-money.premium').incompatibleRules.includes('smart-money.discount'));
  assert.ok(byId('structure.higher-high').incompatibleRules.includes('structure.lower-low'));
  for(const rule of TRADING_DNA_RULES)for(const related of [...rule.incompatibleRules,...rule.complementaryRules])assert.ok(TRADING_DNA_RULES.some(candidate=>candidate.id===related),`${rule.id} → ${related}`);
});

test('documentation participates in ranked search',()=>{
  assert.ok(searchTradingDnaRules('guarantee outcome').length>0);
  assert.ok(searchTradingDnaRules('Accept condition operator').length>0);
});
