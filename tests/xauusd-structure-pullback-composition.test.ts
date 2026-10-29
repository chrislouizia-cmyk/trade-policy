import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { FairValueGap } from '../lib/market-intelligence/imbalance/fair-value-gap/fair-value-gap-lifecycle-types.ts';
import { composePreregisteredStrategySetups, createPreregisteredStrategyComposer, resolveStrategySetupStatus, serializeStrategyCompositionResult, StrategyCompositionError, XAUUSD_STRUCTURE_PULLBACK_DNA_SHA256 } from '../lib/research/strategy-composition/xauusd-structure-pullback/index.ts';

const dna = readFileSync('research/strategies/xauusd-structure-pullback/1.0.0/strategy-dna.json', 'utf8');
const at = (minute: number): string => new Date(Date.UTC(2024, 0, 1, 0, minute)).toISOString();
const request = { strategyId: 'xauusd-structure-pullback' as const, strategyVersion: '1.0.0' as const, referenceTimestamp: at(60), referencePrice: 2400, symbol: 'XAUUSD', timeframe: 'M15', direction: 'LONG' as const };
const gap = (id: string, detected: number, invalidated: number | null = null): FairValueGap => ({ id, version: '1.0.0', direction: 'BULLISH', status: invalidated ? 'INVALIDATED' : 'ACTIVE', lowerBound: 2380, upperBound: 2390, midpoint: 2385, gapSize: 10, gapSizeRelative: .004, gapSizeAtrMultiple: null, candle1Index: 1, candle2Index: 2, candle3Index: 3, candle1Id: 'c1', candle2Id: 'c2', candle3Id: 'c3', createdAt: at(detected), detectedAt: at(detected), firstTouchedAt: null, partiallyMitigatedAt: null, fullyMitigatedAt: null, invalidatedAt: invalidated === null ? null : at(invalidated), expiredAt: null, maximumFillPercent: 0, remainingLowerBound: 2380, remainingUpperBound: 2390, middleCandleBody: 5, middleCandleRange: 8, sourceGapIds: [], lifecycleEventIds: [], evidence: [], fingerprint: id });
const compose = (extra: Record<string, unknown> = {}) => composePreregisteredStrategySetups({ request, strategyDna: dna, ...extra });

test('verifies the immutable raw Strategy DNA SHA-256 before composition', () => {
  const result = compose();
  assert.equal(result.strategyDnaHash, XAUUSD_STRUCTURE_PULLBACK_DNA_SHA256);
  assert.equal(result.warnings.includes('STRATEGY_DNA_HASH_MISMATCH'), false);
});

test('hash mismatch blocks every setup with an explicit reason', () => {
  const result = composePreregisteredStrategySetups({ request, strategyDna: `${dna}\n` });
  assert.equal(result.setups[0]!.status, 'BLOCKED');
  assert.ok(result.setups[0]!.blockingReasons.includes('STRATEGY_DNA_HASH_MISMATCH'));
});

test('every actual preregistered condition receives one stable evaluation', () => {
  const result = compose(), ids = result.setups[0]!.conditionEvaluations.map((v) => v.conditionId);
  assert.deepEqual(ids, ['entry.structure-shift', 'entry.displacement', 'dependency.liquidity-sweep', 'entry.retrace-zone', 'entry.trigger', 'entry.session', 'entry.timing', 'entry.zone-expiry', 'entry.one-per-structure', 'risk.structural-stop', 'reward.liquidity-target', 'reward.minimum-rr', 'risk.invalidation', 'exit.maximum-holding', 'exit.precedence-and-execution']);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(result.setups[0]!.conditionEvaluations.every((v) => v.fingerprint.length > 0));
});

test('actual unresolved mandatory semantics conservatively keep composition BLOCKED', () => {
  const result = compose(), setup = result.setups[0]!;
  assert.equal(setup.status, 'BLOCKED');
  assert.match(setup.blockingReasons.join(' '), /DNA_OMITS_SWEEP_BINDING_SEMANTICS/);
  assert.match(setup.blockingReasons.join(' '), /DNA_DOES_NOT_DEFINE_ZONE_REJECTION_GEOMETRY/);
  assert.equal(setup.selectedStopCandidateId, null); assert.equal(setup.selectedLiquidityTargetId, null); assert.equal(setup.eligibleEntryZone, null);
});

test('wrong symbol and timeframe are recorded as direct invalidations without outranking blockers', () => {
  const result = composePreregisteredStrategySetups({ request: { ...request, symbol: 'EURUSD', timeframe: 'H1' }, strategyDna: dna }), setup = result.setups[0]!;
  assert.equal(setup.status, 'BLOCKED');
  assert.deepEqual(setup.invalidationReasons, ['SYMBOL_MUST_BE_XAUUSD', 'TIMEFRAME_MUST_BE_M15']);
});

test('status precedence is BLOCKED, INVALID, AMBIGUOUS, INCOMPLETE, then COMPLETE', () => {
  assert.equal(resolveStrategySetupStatus(['SATISFIED'], { blocking: ['blocked'], invalid: ['invalid'], ambiguous: ['ambiguous'] }), 'BLOCKED');
  assert.equal(resolveStrategySetupStatus(['SATISFIED'], { invalid: ['invalid'], ambiguous: ['ambiguous'] }), 'INVALID');
  assert.equal(resolveStrategySetupStatus(['SATISFIED'], { ambiguous: ['ambiguous'] }), 'AMBIGUOUS');
  assert.equal(resolveStrategySetupStatus(['UNSATISFIED']), 'INCOMPLETE');
  assert.equal(resolveStrategySetupStatus(['SATISFIED']), 'COMPLETE');
});

test('both DNA directions are independently evaluated when direction is omitted', () => {
  const { direction: _direction, ...bothRequest } = request;
  const result = composePreregisteredStrategySetups({ request: bothRequest, strategyDna: dna });
  assert.deepEqual(result.setups.map((v) => v.direction), ['LONG', 'SHORT']);
  assert.equal(result.conditionCoverage.total, 30);
});

test('historical FVG state is stable and future invalidation cannot rewrite composition', () => {
  const activeThenInvalid = gap('gap', 30, 90), historical = compose({ fairValueGaps: [activeThenInvalid] });
  const condition = historical.setups[0]!.conditionEvaluations.find((v) => v.conditionId === 'entry.retrace-zone')!;
  assert.deepEqual(condition.sourceObjectIds, ['gap']);
  const terminalBefore = compose({ fairValueGaps: [gap('gap', 30, 50)] });
  assert.deepEqual(terminalBefore.setups[0]!.conditionEvaluations.find((v) => v.conditionId === 'entry.retrace-zone')!.sourceObjectIds, []);
});

test('candidate bindings require exact reference identity and never select stop or target', () => {
  const stop = { id: 'stop', version: '1.0.0', direction: 'FOR_LONG', candidateType: 'PROTECTED_SWING', sourceCandidateTypes: ['PROTECTED_SWING'], rawInvalidationPrice: 2380, effectiveStopPrice: 2379, appliedBuffer: 1, referencePrice: 2400, referenceTimestamp: at(60), absoluteDistance: 21, relativeDistance: .00875, atrNormalizedDistance: null, sourceSwingIds: ['s'], sourceSwingLabels: ['HL'], sourceSnapshotIds: ['ss'], sourceSweepEventIds: [], sourceFvgIds: [], sourceBosEventIds: [], sourceTransitionEventIds: [], sourceDetectedAt: at(40), sourceDescription: 'test', structuralPriority: 1, rank: 1, valid: true, rejectionReason: null, evidence: [], fingerprint: 'stop' } as const;
  const result = compose({ stopCandidates: [stop] }), setup = result.setups[0]!;
  assert.deepEqual(setup.eligibleStopCandidateIds, ['stop']); assert.equal(setup.selectedStopCandidateId, null);
  const wrongContext = compose({ stopCandidates: [{ ...stop, id: 'other', referenceTimestamp: at(45) }] });
  assert.deepEqual(wrongContext.setups[0]!.eligibleStopCandidateIds, []);
});

test('batch and stateful composition are byte-identical, repeat-safe, and reject history mutation', () => {
  const composer = createPreregisteredStrategyComposer({ strategyDna: dna });
  composer.pushFairValueGap(gap('gap', 30, 90));
  const stateful = composer.compose(request), batch = compose({ fairValueGaps: [gap('gap', 30, 90)] });
  assert.equal(JSON.stringify(stateful), JSON.stringify(batch));
  assert.equal(JSON.stringify(composer.compose(request)), JSON.stringify(stateful));
  composer.pushFairValueGap(gap('future', 90));
  assert.equal(JSON.stringify(composer.compose(request)), JSON.stringify(stateful));
  assert.throws(() => composer.pushFairValueGap(gap('old', 20)), StrategyCompositionError);
  composer.reset(); assert.equal(composer.compose(request).setups[0]!.conditionEvaluations.find((v) => v.conditionId === 'entry.retrace-zone')!.sourceObjectIds.length, 0);
  const duplicate = createPreregisteredStrategyComposer({ strategyDna: dna }); duplicate.pushFairValueGap(gap('same', 20));
  assert.throws(() => duplicate.pushFairValueGap(gap('same', 30)), StrategyCompositionError);
});

test('duplicate batch identities reject and serialization, graph, evidence, and IDs are deterministic', () => {
  assert.throws(() => compose({ fairValueGaps: [gap('same', 20), gap('same', 30)] }), StrategyCompositionError);
  const first = compose({ fairValueGaps: [gap('gap', 30)] }), second = compose({ fairValueGaps: [gap('gap', 30)] });
  assert.equal(serializeStrategyCompositionResult(first), serializeStrategyCompositionResult(second));
  assert.equal(first.setups[0]!.id, second.setups[0]!.id);
  assert.deepEqual(first.compositionGraph, second.compositionGraph);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.setups[0]));
});

test('composition module has no AI, route, UI, execution, detector implementation, clock, or randomness dependency', () => {
  const source = readFileSync('lib/research/strategy-composition/xauusd-structure-pullback/xauusd-structure-pullback-composer.ts', 'utf8');
  assert.doesNotMatch(source, /from ['"].*(\/ai\/|\/app\/|\/routes?\/|\/ui\/|\/execution\/|detector\.ts)/i);
  assert.doesNotMatch(source, /Date\.now|Math\.random|randomUUID/);
});

test('research audit records partial composition support and preserves the blocked research status', () => {
  const audit = readFileSync('research/strategies/xauusd-structure-pullback/1.0.0/detector-dependency-audit.md', 'utf8');
  assert.match(audit, /\| Executable strategy composition \| PARTIALLY_SUPPORTED \| `xauusd-structure-pullback-composer@1\.0\.0`/);
  assert.match(audit, /conclusion remains `DETECTOR_IMPLEMENTATION_REQUIRED`/);
  assert.match(audit, /no official backtest is authorized/);
});
