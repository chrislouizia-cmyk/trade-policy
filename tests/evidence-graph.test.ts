import assert from 'node:assert/strict';
import test from 'node:test';
import type { DetectorResult, MarketContext, RetestObservation, TrendObservation } from '../lib/market-intelligence/contracts.ts';
import { EvidenceGraphBuilder, EvidenceGraphSerializer, EvidenceGraphValidator, type EvidenceGraph } from '../lib/market-intelligence/evidence-graph/index.ts';
import { CompositionRuleRunner, createCompositionRuleRegistry } from '../lib/market-intelligence/strategy-composition/index.ts';
import { StrategyDefinitionCompiler, type DeclarativeStrategyDefinition } from '../lib/market-intelligence/strategy-definitions/index.ts';

const requestedAt = '2026-12-01T09:30:00.000Z', freshness = { state: 'FRESH' as const, dataAsOf: requestedAt, ageMs: 0, maximumAgeMs: 60_000 };
const registry = createCompositionRuleRegistry();
const sourceDefinition: DeclarativeStrategyDefinition = { id: 'gold-explanation', name: 'Gold Explanation', version: '1.0.0', tradingStyle: 'INTRADAY', supportedSymbols: ['XAUUSD'], supportedAssetClasses: [], timeframeRoles: { confirmation: 'H1', entry: 'M15' }, rules: [{ ruleId: 'trend-alignment', enabled: true, requirement: 'REQUIRED', timeframeRole: 'confirmation', parameters: { requiredTrend: 'BULLISH' }, confidenceContribution: 0.6, executionOrder: 1 }, { ruleId: 'retest', enabled: true, requirement: 'OPTIONAL', timeframeRole: 'entry', parameters: {}, confidenceContribution: 0.4, executionOrder: 2 }], validation: { schemaVersion: '1.0.0', status: 'VALIDATED', description: 'Evidence graph fixture.', tags: ['test'] } };
const detector = (detectorId: string, timeframe: string, payload: DetectorResult['payload'], evidenceId: string): DetectorResult => ({ detectorId, detectorVersion: '1.0.0', runId: 'run-1', instrument: 'XAUUSD', timeframe, observedAt: requestedAt, dataAsOf: requestedAt, status: 'DETECTED', confidence: 1, payload, evidence: [{ id: evidenceId, type: 'CANDLE_SERIES', description: `${detectorId} source evidence`, sourceReference: 'snapshot-1' }], freshness, warnings: [] });
const market = (): MarketContext => { const results = [detector('trend', 'H1', { direction: 'BULLISH' } as TrendObservation, 'trend-e1'), detector('retest', 'M15', { retestDetected: true } as RetestObservation, 'retest-e1')]; return { contextId: 'market-context-1', contextVersion: '1.0.0', instrument: 'XAUUSD', provider: 'fixture', providerVersion: '1', timeframes: ['H1', 'M15'], snapshotId: 'snapshot-1', snapshotVersion: '1', snapshotFreshness: freshness, detectorRunId: 'run-1', detectorResults: results, detectorResultsByTimeframe: { H1: [results[0]], M15: [results[1]] }, warnings: [], conflicts: [], overallFreshness: 'FRESH', overallConfidence: 1, dataAsOf: requestedAt, requestedAt, generatedAt: requestedAt }; };
const build = () => { const definition = new StrategyDefinitionCompiler(registry).compile(sourceDefinition), marketContext = market(), strategyContext = new CompositionRuleRunner(registry).execute(definition, marketContext); return { definition, marketContext, strategyContext, graph: new EvidenceGraphBuilder().build(definition, marketContext, strategyContext) }; };

test('builder traces strategy through configured rules, evaluations, observations, evidence, and timeframe roles', () => {
  const { graph } = build();
  assert.equal(graph.nodes.filter((node) => node.type === 'STRATEGY').length, 1); assert.equal(graph.nodes.filter((node) => node.type === 'RULE_CONFIGURATION').length, 2);
  assert.equal(graph.nodes.filter((node) => node.type === 'RULE_EVALUATION').length, 2); assert.equal(graph.nodes.filter((node) => node.type === 'DETECTOR_OBSERVATION').length, 2); assert.equal(graph.nodes.filter((node) => node.type === 'DETECTOR_EVIDENCE').length, 2);
  for (const type of ['CONFIGURES', 'EVALUATED_AS', 'REFERENCES_OBSERVATION', 'CONTAINS_EVIDENCE', 'USES_TIMEFRAME_ROLE', 'RESOLVES_TO_TIMEFRAME']) assert.ok(graph.edges.some((item) => item.type === type), type);
  assert.ok(graph.nodes.some((node) => node.type === 'TIMEFRAME_ROLE' && node.data.role === 'confirmation' && node.data.timeframe === 'H1')); assert.ok(graph.nodes.some((node) => node.type === 'TIMEFRAME' && node.data.timeframe === 'H1'));
});

test('graph references source results without duplicating detector payloads', () => {
  const { graph } = build(), serialized = JSON.stringify(graph);
  assert.doesNotMatch(serialized, /latestClose|fastAverage|targetLevel|currentClose/);
  const observation = graph.nodes.find((node) => node.type === 'DETECTOR_OBSERVATION' && node.data.detectorId === 'trend')!;
  assert.equal(observation.data.resultIndex, 0); assert.equal(observation.data.status, 'DETECTED');
});

test('graph is deterministic, deeply immutable, and anchored to requestedAt', () => {
  const first = build().graph, second = build().graph;
  assert.deepEqual(first, second); assert.equal(first.generatedAt, requestedAt); assert.equal(Object.isFrozen(first), true); assert.equal(Object.isFrozen(first.nodes), true); assert.equal(Object.isFrozen(first.nodes[0].data), true); assert.equal(Object.isFrozen(first.edges[0]), true);
});

test('validator accepts a complete DAG and rejects duplicate, dangling, self, and cyclic edges', () => {
  const graph = build().graph, validator = new EvidenceGraphValidator(); assert.deepEqual(validator.validate(graph), { valid: true, issues: [] });
  const mutable = structuredClone(graph) as EvidenceGraph; mutable.nodes.push({ ...mutable.nodes[0] }); mutable.edges.push({ id: mutable.edges[0].id, type: 'CONFIGURES', from: 'missing', to: 'missing' }, { id: 'self', type: 'CONFIGURES', from: mutable.nodes[0].id, to: mutable.nodes[0].id }, { id: 'cycle', type: 'CONFIGURES', from: mutable.edges[0].to, to: mutable.edges[0].from });
  const codes = validator.validate(mutable).issues.map((issue) => issue.code); for (const code of ['DUPLICATE_NODE_ID', 'DUPLICATE_EDGE_ID', 'MISSING_EDGE_SOURCE', 'MISSING_EDGE_TARGET', 'SELF_EDGE', 'GRAPH_CYCLE']) assert.ok(codes.includes(code), code);
});

test('serializer emits stable canonical JSON and rejects invalid graphs', () => {
  const graph = build().graph, serializer = new EvidenceGraphSerializer(), first = serializer.serialize(graph), second = serializer.serialize(build().graph);
  assert.equal(first, second); assert.equal(JSON.parse(first).graphId, graph.graphId);
  const invalid = structuredClone(graph) as EvidenceGraph; invalid.edges[0].to = 'missing'; assert.throws(() => serializer.serialize(invalid), /invalid evidence graph/i);
});

test('unresolvable references are warnings rather than fabricated source nodes', () => {
  const { definition, marketContext, strategyContext } = build(); const altered = structuredClone(strategyContext); altered.ruleResults[0].evidenceReferences[0].resultIndex = 99;
  const graph = new EvidenceGraphBuilder().build(definition, marketContext, altered);
  assert.ok(graph.warnings.some((warning) => warning.includes('Unresolved evidence reference'))); assert.equal(graph.nodes.filter((node) => node.type === 'DETECTOR_OBSERVATION').length, 1); assert.equal(new EvidenceGraphValidator().validate(graph).valid, true);
});

test('builder rejects mismatched source identities and emits no decisions', () => {
  const { definition, marketContext, strategyContext, graph } = build();
  assert.throws(() => new EvidenceGraphBuilder().build(definition, { ...marketContext, contextId: 'wrong' }, strategyContext), /does not match/);
  const serialized = JSON.stringify(graph); for (const forbidden of ['BUY', 'SELL', 'READY', 'WAIT', 'positionSize', 'entryPrice', 'takeProfit', 'stopLoss']) assert.doesNotMatch(serialized, new RegExp(`"${forbidden}"`));
});
