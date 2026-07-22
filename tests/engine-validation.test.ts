import assert from 'node:assert/strict';
import test from 'node:test';
import type { IntelligencePipelineResult } from '../lib/market-intelligence/pipeline/intelligence-pipeline-types.ts';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import { STANDARD_ACTIONABILITY_POLICY } from '../lib/market-intelligence/decision/index.ts';
import { DEFAULT_DIRECTION_POLICY } from '../lib/market-intelligence/direction/index.ts';
import { bootstrapMean, DEFAULT_ENGINE_VALIDATION_PROTOCOL, EngineValidator, extractOpportunityExplainability, PipelineReplayAdapter, renderValidationReportMarkdown, wilsonInterval, type EngineValidationProtocol, type HistoricalValidationDataset, type PipelineReplayPort } from '../lib/market-intelligence/engine-validation/index.ts';
import { BALANCED_READINESS_POLICY } from '../lib/market-intelligence/readiness/index.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRunner } from '../lib/market-intelligence/runner/detector-runner.ts';
import { CompositionRuleRunner, createCompositionRuleRegistry } from '../lib/market-intelligence/strategy-composition/index.ts';
import { StrategyDefinitionCompiler, type DeclarativeStrategyDefinition } from '../lib/market-intelligence/strategy-definitions/index.ts';
import { createValidationConfigurationHash, EXPLAINABILITY_FRAMEWORK_VERSION, VALIDATION_FRAMEWORK_VERSION, type ResearchArtifactProvenance } from '../lib/market-intelligence-lab/reproducibility/index.ts';

const start = Date.parse('2025-01-01T00:00:00.000Z');
const candles = Array.from({ length: 360 }, (_, index) => {
  const cycle = index % 20, movement = cycle < 12 ? 1.4 : -1.1, close = 1900 + index * .08 + movement;
  return { openedAt: new Date(start + index * 900_000).toISOString(), closedAt: new Date(start + (index + 1) * 900_000).toISOString(), open: close - movement * .4, high: Math.max(close, close - movement * .4) + .5, low: Math.min(close, close - movement * .4) - .5, close, volume: 100 + cycle, complete: true };
});
const dataset: HistoricalValidationDataset = { id: 'gold-fixture', version: '1.0.0', instrument: 'XAUUSD', assetClass: 'METALS', timeframe: 'M15', provider: 'fixture', contentHash: 'abcdef1234567890', certificationStatus: 'CERTIFIED', candles };
const protocol = { ...DEFAULT_ENGINE_VALIDATION_PROTOCOL, warmupCandles: 30, horizonCandles: 2, sampleStride: 2, bootstrapIterations: 100, calibrationFraction: .65, readinessThresholds: [0, 25, 50, 75, 100], minimumThresholdCoverage: .02 } as const;
const provenance = (detectorIds: readonly string[], value: EngineValidationProtocol = protocol): ResearchArtifactProvenance => ({ provenanceVersion: '1.0.0', experimentId: 'TP-EXP-2026-0001', datasetId: dataset.id, datasetHash: dataset.contentHash, datasetCertification: 'CERTIFIED', strategyId: 'fixture', strategyVersion: '1.0.0', compiledStrategyId: 'compiled:fixture', strategyDefinitionHash: '1234567890abcdef', strategyImmutable: true, pipelineVersion: '1.0.0', detectorVersions: Object.fromEntries(detectorIds.map((id) => [id, '1.0.0'])), decisionPolicyVersion: '1.0.0', readinessPolicyVersion: '1.0.0', directionPolicyVersion: '1.0.0', validationFrameworkVersion: VALIDATION_FRAMEWORK_VERSION, explainabilityFrameworkVersion: EXPLAINABILITY_FRAMEWORK_VERSION, gitCommitSha: '44e606e1234567890abcdef', randomSeed: value.seed, configurationHash: createValidationConfigurationHash(value, detectorIds, 'compiled:fixture'), executionTimestamp: '2026-07-21T00:00:00.000Z', executionEnvironment: { runtime: 'node', runtimeVersion: '24.0.0', operatingSystem: 'darwin', architecture: 'arm64', deployment: 'test', timezone: 'UTC' }, deterministicReplay: true, statisticalProtocolLocked: true });

class FixtureReplay implements PipelineReplayPort {
  calls: { lastClose: string; requestedAt: string; detectorIds: readonly string[] }[] = [];
  async evaluate(input: Parameters<PipelineReplayPort['evaluate']>[0]): Promise<IntelligencePipelineResult> {
    this.calls.push({ lastClose: input.candles.at(-1)!.closedAt, requestedAt: input.requestedAt, detectorIds: input.detectorIds });
    const index = candles.findIndex((candle) => candle.closedAt === input.requestedAt), readiness = (index % 5) * 25, naturalDirection = index % 20 < 12 ? 'BUY' : 'SELL', direction = index % 3 ? naturalDirection : naturalDirection === 'BUY' ? 'SELL' : 'BUY';
    const detectorResults = input.detectorIds.map((detectorId) => ({ detectorId, detectorVersion: '1.0.0', status: index % 9 === 0 ? 'NOT_DETECTED' : 'DETECTED', payload: { classification: index % 9 === 0 ? 'NONE' : 'ACTIVE' }, evidence: [{ id: `${detectorId}:${index}` }] }));
    return { pipelineResultId: `pipeline:${index}:${input.detectorIds.join(',')}`, version: '1.0.0', requestedAt: input.requestedAt, symbol: input.dataset.instrument, assetClass: input.dataset.assetClass, strategyId: 'fixture', strategyVersion: '1.0.0', compiledStrategyId: 'compiled:fixture', configurationFingerprint: 'fixture', status: 'COMPLETED', stages: [], marketDataSnapshot: null, marketContext: { detectorResults } as never, strategyContext: null, evidenceGraph: null, confidenceAssessment: null, readinessAssessment: { confidencePercent: readiness, status: readiness >= 50 ? 'READY' : 'WAIT' } as never, decisionAssessment: { actionable: readiness >= 50 } as never, directionAssessment: { direction } as never, warnings: [], errors: [], summary: { completedStages: 9, partialStages: 0, blockedStages: 0, unavailableStages: 0, errorStages: 0, detectorCount: detectorResults.length, matchedRules: 0, failedRules: 0, meaning: 'INFORMATIONAL_DECISION_SUPPORT_NOT_TRADE_EXECUTION' } };
  }
}

test('Wilson and seeded bootstrap intervals are bounded and deterministic', () => {
  const interval = wilsonInterval(60, 100);
  assert.equal(interval.estimate, .6); assert.ok(interval.lower < .6 && interval.upper > .6);
  assert.deepEqual(bootstrapMean([1, 2, 3, 4], 100, 42), bootstrapMean([1, 2, 3, 4], 100, 42));
});

test('engine validation is chronological, lookahead-safe, deterministic, and JSON serializable', async () => {
  const replay = new FixtureReplay(), validator = new EngineValidator(replay);
  const ids = ['trend', 'retest', 'displacement'], first = await validator.validate(dataset, ids, protocol, provenance(ids)), second = await new EngineValidator(new FixtureReplay()).validate(dataset, ids, protocol, provenance(ids));
  assert.deepEqual(second, first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.ok(replay.calls.every((call) => call.lastClose === call.requestedAt));
  assert.ok(first.calibration.sampleSize > first.holdout.sampleSize);
  assert.ok(first.calibration.selectedThreshold !== null);
  assert.equal(first.detectorContributions.length, 3);
  assert.equal(first.explainability.detectors.length, 3);
  assert.equal(first.explainability.interactionMatrix.length, 3);
  assert.equal(first.explainability.opportunities.length, first.holdout.sampleSize);
  assert.ok(first.explainability.opportunities.every((item) => item.trace.detectorTraces.length === 3));
  assert.deepEqual(first.explainability.calibrationPriority.slice().sort(), ['displacement', 'retest', 'trend']);
  assert.deepEqual(first.baselines.map((item) => item.id), ['RANDOM_SELECTION', 'SMA_10_24']);
  assert.equal(first.generatedAt, candles.at(-1)!.closedAt);
});

test('report includes metrics, charts, baselines, contributions, conclusions, and limitations', async () => {
  const report = await new EngineValidator(new FixtureReplay()).validate(dataset, ['trend'], protocol, provenance(['trend'])), markdown = renderValidationReportMarkdown(report);
  for (const text of ['Reproducibility', '100/100', 'FULLY REPRODUCIBLE', 'Dataset hash', 'Git commit', 'Holdout performance', 'False-positive rate', 'Readiness threshold curve', 'xychart-beta', 'RANDOM_SELECTION', 'SMA_10_24', 'Detector leave-one-out analysis', 'Systematic failure segments', 'Engine explainability', 'Detector interaction matrix', 'Potential detector redundancy', 'Regime failures', 'Pipeline timing diagnostics', 'Limitations']) assert.match(markdown, new RegExp(text, 'i'));
  assert.doesNotMatch(markdown, /guaranteed profit/i);
});

test('validation rejects incomplete or inconsistent research provenance', async () => { const validator = new EngineValidator(new FixtureReplay()), value = provenance(['trend']); await assert.rejects(() => validator.validate(dataset, ['trend'], protocol, { ...value, datasetHash: 'wrong-hash' }), /provenance is incomplete/i); await assert.rejects(() => validator.validate(dataset, ['trend'], protocol, { ...value, randomSeed: value.randomSeed + 1 }), /provenance is incomplete/i); await assert.rejects(() => validator.validate(dataset, ['trend'], protocol, { ...value, configurationHash: 'wrong' }), /provenance is incomplete/i); });

test('historical adapter executes the existing deterministic pipeline without a production provider', async () => {
  const registry = createCompositionRuleRegistry(), definition: DeclarativeStrategyDefinition = { id: 'validation-fixture', name: 'Validation fixture', version: '1.0.0', tradingStyle: 'INTRADAY', supportedSymbols: ['XAUUSD'], supportedAssetClasses: ['METALS'], timeframeRoles: { entry: 'M15' }, rules: [{ ruleId: 'trend-alignment', enabled: true, requirement: 'REQUIRED', timeframeRole: 'entry', parameters: { requiredTrend: 'BULLISH' }, confidenceContribution: 1, executionOrder: 1 }], validation: { schemaVersion: '1.0.0', status: 'VALIDATED', description: 'Research-only fixture', tags: ['engine-validation'] }, directionConfiguration: { mode: 'FIXED', fixedDirection: 'BUY', conflictBehavior: 'NO_DIRECTION' } };
  let tick = 0;
  const adapter = new PipelineReplayAdapter({ dependencies: { runner: new DetectorRunner(createDetectorRegistry()), contextBuilder: new AnalysisContextBuilder(), compositionRunner: new CompositionRuleRunner(registry) }, compiledStrategy: new StrategyDefinitionCompiler(registry).compile(definition), config: { readinessPolicy: { ...BALANCED_READINESS_POLICY, minimumConfidencePercent: 0, minimumCoveragePercent: 0 }, decisionPolicy: { ...STANDARD_ACTIONABILITY_POLICY, minimumConfidencePercent: 0, minimumCoveragePercent: 0, minimumMatchedRuleCount: 2 }, directionPolicy: DEFAULT_DIRECTION_POLICY }, now: () => tick++ });
  const window = candles.slice(0, 30), input = { dataset, candles: window, requestedAt: window.at(-1)!.closedAt, detectorIds: ['trend'] }, { result, timing, counterfactualDirection } = await adapter.evaluateWithTrace(input);
  assert.equal(result.stages.length, 9);
  assert.equal(result.marketDataSnapshot?.provider, 'historical:fixture');
  assert.equal(result.marketDataSnapshot?.requestedAt, window.at(-1)!.closedAt);
  assert.equal(result.marketContext?.detectorResults[0]?.detectorId, 'trend');
  assert.equal(result.decisionAssessment?.outcome, 'NO_ACTION');
  assert.equal(result.directionAssessment?.direction, null);
  assert.equal(counterfactualDirection, 'BUY');
  assert.equal(result.evidenceGraph?.nodes.some((node) => node.type === 'DETECTOR_OBSERVATION'), true);
  assert.deepEqual(timing.stages.map((item) => item.stage), ['MARKET_DATA', 'DETECTORS', 'MARKET_CONTEXT', 'STRATEGY_COMPOSITION', 'EVIDENCE_GRAPH', 'CONFIDENCE', 'READINESS', 'DECISION', 'DIRECTION']);
  assert.equal(timing.diagnosticOnly, true);
  assert.ok(timing.totalDurationMs > 0 && timing.stages.every((item) => item.durationMs > 0));
  const trace = extractOpportunityExplainability(result, timing, counterfactualDirection);
  assert.equal(trace.evidenceGraph?.graphId, result.evidenceGraph?.graphId);
  assert.deepEqual(trace.decisionPath.map((item) => item.criterionId), result.decisionAssessment?.criteria.map((item) => item.criterionId));
  assert.equal(trace.detectorTraces[0]?.confidenceEarnedWeight, 1);
  assert.equal(trace.detectorTraces[0]?.readinessContributionPercent, 100);
  assert.equal(trace.finalDirection, 'BUY');
  assert.equal(trace.directionSource, 'DIAGNOSTIC');
});

test('short, incomplete, disordered, and malformed datasets are rejected before pipeline execution', async () => {
  const validator = new EngineValidator(new FixtureReplay());
  await assert.rejects(() => validator.validate({ ...dataset, candles: candles.slice(0, 10) }, ['trend'], protocol, provenance(['trend'])), /too short/i);
  await assert.rejects(() => validator.validate({ ...dataset, candles: candles.map((candle, index) => index === 2 ? { ...candle, complete: false } : candle) }, ['trend'], protocol, provenance(['trend'])), /completed candles/i);
  await assert.rejects(() => validator.validate({ ...dataset, candles: [candles[1]!, candles[0]!, ...candles.slice(2)] }, ['trend'], protocol, provenance(['trend'])), /strictly ordered/i);
  await assert.rejects(() => validator.validate({ ...dataset, candles: candles.map((candle, index) => index === 2 ? { ...candle, high: candle.low - 1 } : candle) }, ['trend'], protocol, provenance(['trend'])), /geometry/i);
});

test('insufficient approved holdout evidence produces an explicit inconclusive conclusion', async () => {
  const sparseProtocol = { ...protocol, sampleStride: 4 }, report = await new EngineValidator(new FixtureReplay()).validate({ ...dataset, candles: candles.slice(0, 100) }, ['trend'], sparseProtocol, provenance(['trend'], sparseProtocol));
  assert.equal(report.conclusion.verdict, 'INCONCLUSIVE');
  assert.match(report.conclusion.statements.join(' '), /fewer than 100/i);
});

test('framework remains research-only and has no production route, Supabase, persistence, or wall-clock dependency', async () => {
  const fs = await import('node:fs/promises'), files = ['engine-validator.ts', 'metrics.ts', 'statistics.ts', 'baselines.ts', 'pipeline-replay-adapter.ts'];
  for (const file of files) {
    const source = await fs.readFile(new URL(`../lib/market-intelligence/engine-validation/${file}`, import.meta.url), 'utf8');
    for (const forbidden of ['Date.now', 'Math.random', 'Supabase', '.insert(', '.update(', 'fetch(']) assert.doesNotMatch(source, new RegExp(forbidden.replace('(', '\\('), 'i'), `${file}: ${forbidden}`);
  }
});
