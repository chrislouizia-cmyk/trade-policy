import assert from 'node:assert/strict';
import test from 'node:test';
import type { DetectorResult, DisplacementObservation, MarketContext, RetestObservation, TrendObservation } from '../lib/market-intelligence/contracts.ts';
import { CompositionRuleRunner, createCompositionRuleRegistry } from '../lib/market-intelligence/strategy-composition/index.ts';
import { StrategyDefinitionCompilationError, StrategyDefinitionCompiler, StrategyDefinitionValidator, type DeclarativeStrategyDefinition } from '../lib/market-intelligence/strategy-definitions/index.ts';

const requestedAt = '2026-11-04T15:00:00.000Z';
const registry = createCompositionRuleRegistry();
const definition = (): DeclarativeStrategyDefinition => ({
  id: 'gold-intraday-v1', name: 'Gold Intraday V1', version: '1.0.0', tradingStyle: 'INTRADAY', supportedSymbols: ['XAUUSD'], supportedAssetClasses: ['METALS'],
  timeframeRoles: { confirmation: 'H1', entry: 'M15', trigger: 'M5' },
  rules: [
    { ruleId: 'retest', enabled: true, requirement: 'OPTIONAL', timeframeRole: 'entry', parameters: {}, confidenceContribution: 0.25, executionOrder: 20 },
    { ruleId: 'displacement', enabled: false, requirement: 'OPTIONAL', timeframeRole: 'trigger', parameters: {}, confidenceContribution: 0.1, executionOrder: 30 },
    { ruleId: 'trend-alignment', enabled: true, requirement: 'REQUIRED', timeframeRole: 'confirmation', parameters: { requiredTrend: 'BULLISH' }, confidenceContribution: 0.75, executionOrder: 10 },
  ],
  validation: { schemaVersion: '1.0.0', status: 'VALIDATED', description: 'Fixed declarative test strategy.', tags: ['gold', 'intraday'], author: 'Trade Police' },
});
const freshness = { state: 'FRESH' as const, dataAsOf: requestedAt, ageMs: 0, maximumAgeMs: 60_000 };
const detector = (detectorId: string, timeframe: string, payload: DetectorResult['payload']): DetectorResult => ({ detectorId, detectorVersion: '1.0.0', runId: 'run', instrument: 'XAUUSD', timeframe, observedAt: requestedAt, dataAsOf: requestedAt, status: 'DETECTED', confidence: 1, payload, evidence: [{ id: `${detectorId}:${timeframe}`, type: 'FIXTURE', description: 'fixture' }], freshness, warnings: [] });
const trend = { direction: 'BULLISH' } as TrendObservation, retest = { retestDetected: true } as RetestObservation, displacement = { displacementDetected: true } as DisplacementObservation;
const context = (): MarketContext => {
  const results = [detector('trend', 'H1', trend), detector('retest', 'M15', retest), detector('displacement', 'M5', displacement)];
  return { contextId: 'market:1', contextVersion: '1.0.0', instrument: 'XAUUSD', provider: 'fixture', providerVersion: '1', timeframes: ['H1', 'M15', 'M5'], snapshotId: 'snapshot', snapshotVersion: '1', snapshotFreshness: freshness, detectorRunId: 'run', detectorResults: results, detectorResultsByTimeframe: { H1: [results[0]], M15: [results[1]], M5: [results[2]] }, warnings: [], conflicts: [], overallFreshness: 'FRESH', overallConfidence: 1, dataAsOf: requestedAt, requestedAt, generatedAt: requestedAt };
};

test('valid declarative strategy definitions pass validation', () => {
  assert.deepEqual(new StrategyDefinitionValidator(registry).validate(definition()), { valid: true, issues: [] });
});

test('validator reports identity, version, scope, rule, ordering, role, contribution, and schema errors together', () => {
  const invalid = definition(); invalid.id = 'Bad Id'; invalid.version = '1'; invalid.supportedSymbols = []; invalid.supportedAssetClasses = [];
  invalid.rules[0].ruleId = 'unknown'; invalid.rules[0].timeframeRole = 'missing'; invalid.rules[0].confidenceContribution = -1; invalid.rules[0].executionOrder = invalid.rules[1].executionOrder;
  invalid.validation.schemaVersion = '2.0.0' as '1.0.0';
  const result = new StrategyDefinitionValidator(registry).validate(invalid);
  assert.equal(result.valid, false); for (const code of ['INVALID_ID', 'INVALID_VERSION', 'MISSING_MARKET_SCOPE', 'UNKNOWN_RULE', 'UNKNOWN_TIMEFRAME_ROLE', 'INVALID_CONFIDENCE_CONTRIBUTION', 'DUPLICATE_EXECUTION_ORDER', 'UNSUPPORTED_SCHEMA_VERSION']) assert.ok(result.issues.some((issue) => issue.code === code), code);
});

test('compiler rejects invalid definitions with structured issues', () => {
  const invalid = definition(); invalid.rules.push({ ...invalid.rules[0] });
  assert.throws(() => new StrategyDefinitionCompiler(registry).compile(invalid), (error) => error instanceof StrategyDefinitionCompilationError && error.issues.some((issue) => issue.code === 'DUPLICATE_RULE'));
});

test('compiler resolves timeframe roles, enabled rules, requirements, parameters, contribution, and stable order', () => {
  const compiled = new StrategyDefinitionCompiler(registry).compile(definition());
  assert.deepEqual(compiled.ruleExecutionOrder, ['trend-alignment', 'retest']);
  assert.deepEqual(compiled.ruleRequirements, { 'trend-alignment': 'REQUIRED', retest: 'OPTIONAL' });
  assert.deepEqual(compiled.ruleConfiguration?.['trend-alignment'], { requiredTrend: 'BULLISH', timeframeRole: 'confirmation', timeframe: 'H1', confidenceContribution: 0.75 });
  assert.deepEqual(compiled.ruleConfiguration?.retest, { timeframeRole: 'entry', timeframe: 'M15', confidenceContribution: 0.25 });
  assert.equal(compiled.ruleConfiguration?.displacement, undefined); assert.equal(compiled.requiredTrend, 'BULLISH');
});

test('compiled definitions are deterministic, deeply immutable, and JSON serializable', () => {
  const compiler = new StrategyDefinitionCompiler(registry), source = definition(), before = JSON.stringify(source), first = compiler.compile(source), second = compiler.compile(source);
  assert.deepEqual(first, second); assert.deepEqual(JSON.parse(JSON.stringify(first)), first); assert.equal(JSON.stringify(source), before);
  assert.equal(Object.isFrozen(first), true); assert.equal(Object.isFrozen(first.ruleExecutionOrder), true); assert.equal(Object.isFrozen(first.ruleConfiguration?.['trend-alignment']), true); assert.equal(Object.isFrozen(first.validation.tags), true);
});

test('compiled definition configures the existing runner without a strategy class', () => {
  const compiled = new StrategyDefinitionCompiler(registry).compile(definition());
  const output = new CompositionRuleRunner(registry).execute(compiled, context());
  assert.deepEqual(output.ruleResults.map((result) => result.ruleId), ['trend-alignment', 'retest']);
  assert.deepEqual(output.matchedRuleIds, ['trend-alignment', 'retest']); assert.deepEqual(output.confidenceContributions, { 'trend-alignment': 0.75, retest: 0.25 });
  assert.deepEqual(output.ruleResults.map((result) => result.requirement), ['REQUIRED', 'OPTIONAL']);
  assert.deepEqual(output.evidenceMap['trend-alignment'][0].timeframe, 'H1'); assert.deepEqual(output.evidenceMap.retest[0].timeframe, 'M15');
});

test('declarative execution does not emit trade or readiness decisions', () => {
  const output = new CompositionRuleRunner(registry).execute(new StrategyDefinitionCompiler(registry).compile(definition()), context());
  const serialized = JSON.stringify(output);
  for (const forbidden of ['BUY', 'SELL', 'READY', 'WAIT', 'positionSize', 'stopLoss', 'takeProfit', 'entryPrice']) assert.doesNotMatch(serialized, new RegExp(`"${forbidden}"`));
});
