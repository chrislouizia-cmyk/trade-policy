import assert from 'node:assert/strict';
import test from 'node:test';
import type { DetectorResult, DisplacementObservation, MarketContext, RetestObservation, TrendObservation } from '../lib/market-intelligence/contracts.ts';
import { CompositionRuleRegistry, CompositionRuleRunner, createCompositionRuleRegistry, type CompositionRule, type RuleEvaluationResult, type StrategyDefinition } from '../lib/market-intelligence/strategy-composition/index.ts';
import { TrendAlignmentRule } from '../lib/market-intelligence/strategy-composition/rules/trend-alignment-rule.ts';

const requestedAt = '2026-10-01T12:00:00.000Z';
const freshness = { state: 'FRESH' as const, dataAsOf: requestedAt, ageMs: 0, maximumAgeMs: 60_000 };
const result = (detectorId: string, payload: DetectorResult['payload'], timeframe = 'M15'): DetectorResult => ({
  detectorId, detectorVersion: '1.0.0', runId: 'run-1', instrument: 'XAUUSD', timeframe,
  observedAt: requestedAt, dataAsOf: requestedAt, status: 'DETECTED', confidence: 1, payload,
  evidence: [{ id: `${detectorId}-evidence`, type: 'FIXTURE', description: 'fixture' }], freshness, warnings: [],
});
const trend = { timeframe: 'M15', direction: 'BULLISH', latestClose: 10, fastAverage: { type: 'SMA', period: 10, value: 9 }, slowAverage: { type: 'SMA', period: 24, value: 8 }, fastSlowDifference: 1, fastSlowDifferencePercent: 12.5, closeToSlowDifference: 2, closeToSlowDifferencePercent: 25, candleCount: 24, sourceStartTime: requestedAt, sourceEndTime: requestedAt, lastCandleTime: requestedAt } satisfies TrendObservation;
const retest = { timeframe: 'M15', classification: 'RETEST', retestDetected: true } as RetestObservation;
const displacement = { timeframe: 'M15', classification: 'NOT_DISPLACEMENT', displacementDetected: false } as DisplacementObservation;
const marketContext = (results: DetectorResult[] = [result('trend', trend), result('retest', retest), result('displacement', displacement)]): MarketContext => ({
  contextId: 'market-context-1', contextVersion: '1.0.0', instrument: 'XAUUSD', provider: 'fixture', providerVersion: '1', timeframes: ['M15'], snapshotId: 'snapshot-1', snapshotVersion: '1', snapshotFreshness: freshness, detectorRunId: 'run-1', detectorResults: results, detectorResultsByTimeframe: { M15: results }, warnings: [], conflicts: [], overallFreshness: 'FRESH', overallConfidence: 1, dataAsOf: requestedAt, requestedAt, generatedAt: '2099-01-01T00:00:00.000Z',
});
const strategy: StrategyDefinition = { id: 'gold-intraday', version: '1.0.0', requiredTrend: 'BULLISH' };

test('registry supports registration, lookup, ordered listing, execution, and unregister', () => {
  const registry = new CompositionRuleRegistry(); const rule = new TrendAlignmentRule();
  registry.register(rule); assert.equal(registry.get(rule.metadata.id), rule); assert.deepEqual(registry.list(), [rule]);
  assert.equal(registry.execute(rule.metadata.id, strategy, marketContext()).matched, true);
  assert.equal(registry.unregister(rule.metadata.id), true); assert.equal(registry.get(rule.metadata.id), undefined);
  assert.throws(() => registry.execute('missing', strategy, marketContext()), /not registered/);
});

test('registry rejects duplicate ids and returns immutable ordered snapshots', () => {
  const registry = new CompositionRuleRegistry().register(new TrendAlignmentRule());
  assert.throws(() => registry.register(new TrendAlignmentRule()), /already registered/);
  assert.equal(Object.isFrozen(registry.list()), true);
  assert.deepEqual(createCompositionRuleRegistry().list().map((rule) => rule.metadata.id), ['trend-alignment', 'retest', 'displacement']);
});

test('runner evaluates multiple rules in registry order and creates evidence references', () => {
  const context = new CompositionRuleRunner(createCompositionRuleRegistry()).execute(strategy, marketContext());
  assert.deepEqual(context.ruleResults.map((item) => item.ruleId), ['trend-alignment', 'retest', 'displacement']);
  assert.deepEqual(context.matchedRuleIds, ['trend-alignment', 'retest']); assert.deepEqual(context.failedRuleIds, ['displacement']);
  assert.equal(context.totalMatched, 2); assert.equal(context.totalFailed, 1);
  assert.deepEqual(context.evidenceMap['trend-alignment'][0], { detectorId: 'trend', timeframe: 'M15', resultIndex: 0, evidenceIds: ['trend-evidence'] });
  assert.equal(context.executionTimestamp, requestedAt); assert.equal(context.executionSummary.totalRules, 3);
  assert.deepEqual(context.confidenceContributions, { 'trend-alignment': 1, retest: 1, displacement: 0 });
});

test('missing observations and missing strategy requirements are explicit and never matched', () => {
  const runner = new CompositionRuleRunner(createCompositionRuleRegistry());
  const output = runner.execute({ id: 'x', version: '1' }, marketContext([]));
  assert.equal(output.totalMatched, 0); assert.equal(output.totalFailed, 3); assert.equal(output.executionSummary.totalNotEvaluated, 3);
  assert.ok(output.warnings.some((warning) => warning.includes('missing'))); assert.ok(output.ruleResults.every((item) => !item.matched));
});

test('rule execution is deterministic, serializable, and does not mutate MarketContext', () => {
  const input = marketContext(), before = JSON.stringify(input), runner = new CompositionRuleRunner(createCompositionRuleRegistry());
  const first = runner.execute(strategy, input), second = runner.execute(strategy, input);
  assert.deepEqual(first, second); assert.deepEqual(JSON.parse(JSON.stringify(first)), first); assert.equal(JSON.stringify(input), before);
  assert.equal(first.contextId, 'strategy-context:gold-intraday:1.0.0:market-context-1');
});

test('StrategyContext and its nested collections are immutable', () => {
  const output = new CompositionRuleRunner(createCompositionRuleRegistry()).execute(strategy, marketContext());
  assert.equal(Object.isFrozen(output), true); assert.equal(Object.isFrozen(output.ruleResults), true); assert.equal(Object.isFrozen(output.ruleResults[0]), true);
  assert.equal(Object.isFrozen(output.evidenceMap), true); assert.equal(Object.isFrozen(output.evidenceMap.retest[0].evidenceIds), true); assert.equal(Object.isFrozen(output.executionSummary), true);
});

test('runner supports explicit rule ordering and an empty registry', () => {
  const registry = createCompositionRuleRegistry(), runner = new CompositionRuleRunner(registry);
  assert.deepEqual(runner.execute(strategy, marketContext(), ['displacement', 'trend-alignment']).ruleResults.map((item) => item.ruleId), ['displacement', 'trend-alignment']);
  const empty = new CompositionRuleRunner(new CompositionRuleRegistry()).execute(strategy, marketContext());
  assert.deepEqual(empty.ruleResults, []); assert.deepEqual(empty.executionSummary, { totalRules: 0, totalMatched: 0, totalFailed: 0, totalNotEvaluated: 0, totalErrors: 0 });
  assert.throws(() => runner.execute(strategy, marketContext(), ['missing']), /not registered/);
});

test('rule failures and warnings are isolated while context warnings are preserved', () => {
  const throwing: CompositionRule = { metadata: { id: 'throws', name: 'Throws', version: '1', deterministic: true, supportedStrategies: ['*'], description: 'fixture' }, evaluate(): RuleEvaluationResult { throw new Error('boom'); } };
  const context = marketContext(); context.warnings.push('market warning');
  const failed = new CompositionRuleRunner(new CompositionRuleRegistry().register(throwing)).execute(strategy, context);
  assert.equal(failed.ruleResults[0].status, 'ERROR'); assert.equal(failed.executionSummary.totalErrors, 1); assert.ok(failed.warnings.includes('boom'));
  const output = new CompositionRuleRunner(createCompositionRuleRegistry()).execute(strategy, context);
  assert.ok(output.warnings.includes('market warning'));
});
