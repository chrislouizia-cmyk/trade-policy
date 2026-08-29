import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { evaluateHistoricalRulePlan } from '../lib/backtesting/historical-detectors.ts';
import { buildHistoricalRulePlan } from '../lib/backtesting/historical-rule-plan.ts';
import type { StrategyProfile, StrategyRule } from '../types/trade.ts';

const rule = (label: string, ruleKey = label, patch: Partial<StrategyRule> = {}): StrategyRule => ({
  ruleKey, label, enabled: true, mandatory: true, weight: 1, minimumConfidence: 0.5,
  timeframeRole: 'ENTRY', evaluationMode: 'AUTOMATIC', ...patch,
});

const strategy = (rules: StrategyRule[]): StrategyProfile => ({
  id: 'strategy', name: 'GBPUSD structure', instruments: ['GBPUSD'],
  macroTimeframe: 'H4', trendTimeframe: 'H1', confirmationTimeframe: 'M30', entryTimeframe: 'M15', triggerTimeframe: 'M5',
  rules, sessions: [], stopLimits: [], personalRules: [], maximumRiskPercent: 0.5, maximumTradesPerDay: 2,
} as unknown as StrategyProfile);

const candles = (closes: number[], timeframeMinutes = 15) => closes.map((close, index) => ({
  datetime: new Date(Date.UTC(2025, 0, 1, 0, index * timeframeMinutes)).toISOString(),
  open: close - 0.2, high: close + 0.4, low: close - 0.4, close,
}));

const dnaRule = (label: string, ruleId: string, operator: string, inputs: Record<string, unknown> = {}, patch: Partial<StrategyRule> = {}) =>
  rule(label, `dna.v1.${encodeURIComponent(JSON.stringify({ condition: { ruleId, operator, inputs, operands: [] } }))}`, patch);

test('normalization resolves every Phase 1 alias and preserves explicit label timeframe', () => {
  const plan = buildHistoricalRulePlan(strategy([
    rule('Swing High'), rule('Break of Structure'), rule('CHoCH'), rule('Liquidity Sweep'),
    rule('Range Break'), rule('Breakout Confirmation'), rule('Trend Alignment'),
    rule('Order Block M30'), rule('Fair Value Gap'),
  ]));
  assert.deepEqual(plan.rules.map((item) => item.detectorId), [
    'market-structure.swing', 'market-structure.bos', 'market-structure.choch', 'market-structure.liquidity-sweep',
    'price-action.range-break', 'price-action.breakout-confirmation', 'market-structure.trend-alignment',
    'smart-money.order-block', 'smart-money.fair-value-gap',
  ]);
  assert.equal(plan.unsupportedRequiredRules.length, 0);
  assert.equal(plan.rules[7]?.timeframe, 'M30');
  assert.equal(plan.rules[7]?.parameterSources.timeframe?.source, 'EXPLICIT');
});

test('GBPUSD Liquidity Sweep plus CHoCH resolves to executable historical detectors', () => {
  const plan = buildHistoricalRulePlan(strategy([rule('Liquidity Sweep', 'liquidity-sweep'), rule('CHoCH', 'choch')]));
  assert.equal(plan.unsupportedRequiredRules.length, 0);
  assert.deepEqual(plan.rules.map((item) => item.detectorId), ['market-structure.liquidity-sweep', 'market-structure.choch']);
  const replay = evaluateHistoricalRulePlan(plan, { M15: candles(Array.from({ length: 30 }, (_, index) => 100 + Math.sin(index))) }, 'GBPUSD');
  assert.equal(replay.evaluations.length, 2);
  assert.deepEqual(replay.evaluations.map((item) => item.status), ['NOT_MATCHED', 'NOT_MATCHED']);
});

test('unknown required concepts remain structured unsupported rules while descriptive optional rules stay excluded', () => {
  const plan = buildHistoricalRulePlan(strategy([
    rule('Astrology Confluence'),
    rule('Journal note', 'journal-note', { mandatory: false, evaluationMode: 'MANUAL' }),
  ]));
  assert.equal(plan.rules.length, 0);
  assert.equal(plan.unsupportedRequiredRules.length, 1);
  assert.equal(plan.unsupportedRequiredRules[0]?.label, 'Astrology Confluence');
});

test('unsupported required operators are rejected structurally while optional rules remain non-blocking', () => {
  const required = buildHistoricalRulePlan(strategy([dnaRule('BOS equals', 'structure.bos', 'EQUALS', { timeframe: 'M15' })]));
  assert.equal(required.rules.length, 0);
  assert.equal(required.unsupportedRequiredRules.length, 1);
  assert.match(required.unsupportedRequiredRules[0]!.reason, /Operator EQUALS.*not supported/);
  const optional = buildHistoricalRulePlan(strategy([dnaRule('Optional BOS equals', 'structure.bos', 'EQUALS', { timeframe: 'M15' }, { mandatory: false })]));
  assert.equal(optional.rules.length, 0);
  assert.equal(optional.unsupportedRequiredRules.length, 0);
});

test('operators normalize explicitly and negative event semantics are honored', () => {
  const positive = buildHistoricalRulePlan(strategy([dnaRule('Range present', 'range-break', 'IS_TRUE', { timeframe: 'M15', lookback: 20 })]));
  const negative = buildHistoricalRulePlan(strategy([dnaRule('Range absent', 'range-break', 'IS_FALSE', { timeframe: 'M15', lookback: 20 })]));
  assert.equal(positive.rules[0]?.originalOperator, 'IS_TRUE');
  assert.equal(positive.rules[0]?.operator, 'EVENT_CONFIRMED');
  assert.equal(negative.rules[0]?.operator, 'EVENT_NOT_CONFIRMED');
  const flat = candles(Array.from({ length: 21 }, () => 100));
  assert.equal(evaluateHistoricalRulePlan(positive, { M15: flat }, 'GBPUSD').passed, false);
  assert.equal(evaluateHistoricalRulePlan(negative, { M15: flat }, 'GBPUSD').passed, true);
});

test('unsupported required detector timeframes are rejected with the exact invalid timeframe', () => {
  const direct = buildHistoricalRulePlan(strategy([dnaRule('BOS H6', 'structure.bos', 'IS_TRUE', { timeframe: 'h6' })]));
  assert.equal(direct.unsupportedRequiredRules[0]?.timeframe, 'H6');
  assert.match(direct.unsupportedRequiredRules[0]!.reason, /H6.*not supported/);
  const trend = buildHistoricalRulePlan(strategy([dnaRule('Trend H1 and H6', 'structure.trend-alignment', 'IS_TRUE', { timeframe: 'H1', timeframes: ['h1', 'h6'] })]));
  assert.equal(trend.unsupportedRequiredRules[0]?.timeframe, 'H6');
});

test('structural plans freeze swing confirmation defaults and preserve explicit overrides', () => {
  for (const [label, key] of [['BOS', 'structure.bos'], ['CHoCH', 'structure.choch'], ['Liquidity Sweep', 'smart-money.liquidity-sweep']] as const) {
    const item = buildHistoricalRulePlan(strategy([dnaRule(label, key, 'IS_TRUE', { timeframe: 'M15' })])).rules[0]!;
    assert.equal(item.parameters.leftBars, 2, label);
    assert.equal(item.parameters.rightBars, 2, label);
    assert.equal(item.parameterSources.leftBars?.source, 'DEFAULT', label);
    assert.equal(item.parameterSources.rightBars?.source, 'DEFAULT', label);
    assert.equal(item.parameterSources.structureConfiguration?.source, 'DEFAULT', label);
    assert.ok(item.parameters.bosConfiguration, label);
    if (key !== 'structure.bos') assert.ok(item.parameters.detectorConfiguration, label);
  }
  const explicit = buildHistoricalRulePlan(strategy([dnaRule('Explicit BOS', 'structure.bos', 'IS_TRUE', { timeframe: 'M15', leftBars: 3, rightBars: 4 })])).rules[0]!;
  assert.equal(explicit.parameters.leftBars, 3);
  assert.equal(explicit.parameters.rightBars, 4);
  assert.equal(explicit.parameterSources.leftBars?.source, 'EXPLICIT');
  assert.equal(explicit.parameterSources.rightBars?.source, 'EXPLICIT');
});

test('Order Block operator distinguishes newly confirmed from active lifecycle state', () => {
  const source = [
    { datetime: '2025-01-01T00:00:00.000Z', open: 10, high: 10.2, low: 8.8, close: 9 },
    { datetime: '2025-01-01T00:15:00.000Z', open: 9, high: 11.4, low: 8.9, close: 11 },
    { datetime: '2025-01-01T00:30:00.000Z', open: 10.4, high: 10.6, low: 10.05, close: 10.1 },
  ];
  const active = buildHistoricalRulePlan(strategy([dnaRule('Active OB', 'smart-money.order-block', 'IS_TRUE', { timeframe: 'M15' })]));
  const newly = buildHistoricalRulePlan(strategy([dnaRule('New OB', 'smart-money.order-block', 'CONFIRMED', { timeframe: 'M15' })]));
  assert.equal(active.rules[0]?.operator, 'ACTIVE_EXISTS');
  assert.equal(newly.rules[0]?.operator, 'NEWLY_CONFIRMED');
  assert.equal(evaluateHistoricalRulePlan(active, { M15: source }, 'GBPUSD').passed, true);
  assert.equal(evaluateHistoricalRulePlan(newly, { M15: source }, 'GBPUSD').passed, false);
});

test('Fair Value Gap operator distinguishes newly confirmed from active lifecycle state', () => {
  const source = [
    { datetime: '2025-01-01T00:00:00.000Z', open: 9.5, high: 10, low: 9, close: 9.8 },
    { datetime: '2025-01-01T00:15:00.000Z', open: 10, high: 12, low: 9.8, close: 11.8 },
    { datetime: '2025-01-01T00:30:00.000Z', open: 11.5, high: 12.5, low: 11, close: 12 },
    { datetime: '2025-01-01T00:45:00.000Z', open: 12, high: 13, low: 11.4, close: 12.5 },
  ];
  const active = buildHistoricalRulePlan(strategy([dnaRule('Active FVG', 'smart-money.fair-value-gap', 'EXISTS', { timeframe: 'M15' })]));
  const newly = buildHistoricalRulePlan(strategy([dnaRule('New FVG', 'smart-money.fair-value-gap', 'CONFIRMED', { timeframe: 'M15' })]));
  assert.equal(evaluateHistoricalRulePlan(active, { M15: source }, 'GBPUSD').passed, true);
  assert.equal(evaluateHistoricalRulePlan(newly, { M15: source }, 'GBPUSD').passed, false);
});

test('explicit DNA parameters and direction are preserved and defaults are recorded', () => {
  const encoded = `dna.v1.${encodeURIComponent(JSON.stringify({ condition: { ruleId: 'range-break', operator: 'CONFIRMED', inputs: { timeframe: 'M30', lookback: 3, direction: 'LONG' } } }))}`;
  const item = buildHistoricalRulePlan(strategy([rule('Range Break', encoded)])).rules[0]!;
  assert.equal(item.timeframe, 'M30');
  assert.equal(item.lookback, 3);
  assert.equal(item.direction, 'BULLISH');
  assert.equal(item.parameterSources.lookback?.source, 'EXPLICIT');
  assert.equal(item.configurationVersion, '1.0.0');
});

test('range break and breakout confirmation evaluate deterministically without future candles', () => {
  const rangePlan = buildHistoricalRulePlan(strategy([rule('Range Break')]));
  const base = candles(Array.from({ length: 20 }, (_, index) => 100 + (index % 2) * 0.2));
  const positive = [...base, ...candles([102]).map((item) => ({ ...item, datetime: new Date(Date.UTC(2025, 0, 1, 5, 0)).toISOString() }))];
  assert.equal(evaluateHistoricalRulePlan(rangePlan, { M15: base }, 'GBPUSD').passed, false);
  assert.equal(evaluateHistoricalRulePlan(rangePlan, { M15: positive }, 'GBPUSD').passed, true);
  const futureChanged = [...positive, { ...positive.at(-1)!, datetime: new Date(Date.UTC(2025, 0, 1, 5, 15)).toISOString(), close: 50, low: 49 }];
  assert.deepEqual(evaluateHistoricalRulePlan(rangePlan, { M15: positive }, 'GBPUSD'), evaluateHistoricalRulePlan(rangePlan, { M15: futureChanged.slice(0, -1) }, 'GBPUSD'));

  const confirmation = buildHistoricalRulePlan(strategy([rule('Breakout Confirmation')]));
  assert.equal(evaluateHistoricalRulePlan(confirmation, { M15: positive }, 'GBPUSD').passed, true);
});

test('trend alignment handles multiple configured timeframes and returns evidence metadata', () => {
  const plan = buildHistoricalRulePlan(strategy([rule('Trend Alignment')]));
  const rising = candles(Array.from({ length: 30 }, (_, index) => 100 + index), 60);
  const result = evaluateHistoricalRulePlan(plan, { H1: rising, M30: rising }, 'GBPUSD');
  assert.equal(result.passed, true);
  assert.equal(result.evaluations[0]?.evidence.length, 2);
});

test('detector adapters report insufficient history instead of fabricating evidence', () => {
  for (const label of ['Swing High', 'BOS', 'CHoCH', 'Liquidity Sweep', 'Order Block', 'Fair Value Gap']) {
    const plan = buildHistoricalRulePlan(strategy([rule(label)]));
    const evaluation = evaluateHistoricalRulePlan(plan, { M15: candles([100]) }, 'GBPUSD').evaluations[0]!;
    assert.equal(evaluation.passed, false, label);
    assert.equal(evaluation.evidence.length, 0, label);
  }
});

test('API capability validation occurs before entitlement lookup and atomic run creation', () => {
  const source = fs.readFileSync('app/api/backtests/route.ts', 'utf8');
  const validation = source.indexOf('historicalRulePlan.unsupportedRequiredRules.length');
  assert.ok(validation > 0);
  assert.ok(validation < source.indexOf('getBacktestPlanCodeForUser(user.id)'));
  assert.ok(validation < source.indexOf('createBacktestRun({'));
  assert.match(source, /BACKTEST_RULES_UNSUPPORTED/);
  assert.match(source, /unsupportedRules/);
  assert.match(fs.readFileSync('lib/backtesting/historical-rule-plan.ts', 'utf8'), /Historical timeframe.*not supported by the production provider/);
});

test('frozen snapshots and trade evidence carry the canonical plan and evaluations', () => {
  const backtesting = fs.readFileSync('lib/server/backtesting.ts', 'utf8');
  const executor = fs.readFileSync('lib/server/backtest-executor.ts', 'utf8');
  assert.match(backtesting, /strategySnapshot = \{ \.\.\.strategy, historicalRulePlan \}/);
  assert.match(executor, /historical_rule_plan: rulePlan/);
  assert.match(executor, /historical_rule_evaluations: historicalRules\.evaluations/);
  assert.doesNotMatch(executor, /Automatic historical detector not available for:/);
});
