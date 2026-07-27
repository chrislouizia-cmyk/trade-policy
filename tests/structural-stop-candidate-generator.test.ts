import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import type { ConfirmedSwing, SwingDirection } from '../lib/market-intelligence/detectors/confirmed-swing/confirmed-swing-types.ts';
import { detectFairValueGapLifecycles, type FairValueGap } from '../lib/market-intelligence/imbalance/fair-value-gap/index.ts';
import type { StructuralLiquiditySweepEvent } from '../lib/market-intelligence/liquidity/structural-sweep/structural-liquidity-sweep-types.ts';
import { createStructuralStopCandidateGenerator, generateStructuralStopCandidates, serializeStructuralStopCandidateResult, StructuralStopCandidateError, type StructuralStopCandidateConfig } from '../lib/market-intelligence/risk/structural-stop-candidates/index.ts';
import { reduceMarketStructure, type StructureSnapshot } from '../lib/market-intelligence/structure/index.ts';

const at = (minute: number): string => new Date(Date.UTC(2024, 0, 1, 0, minute)).toISOString();
const candle = (minute: number, open: number, high: number, low: number, close: number): NormalizedCandle => ({ openedAt: at(minute), closedAt: at(minute + 1), open, high, low, close, volume: 100, complete: true });
const swing = (id: string, direction: SwingDirection, price: number, minute: number): ConfirmedSwing => ({ id, direction, pivotIndex: minute, confirmedIndex: minute + 1, pivotAt: at(minute), confirmedAt: at(minute + 1), price, leftBars: 1, rightBars: 1, prominence: 1, prominenceAtrMultiple: null, strength: .5, equalPriceConflict: false, sourceCandle: { open: price, high: direction === 'HIGH' ? price : price + 1, low: direction === 'LOW' ? price : price - 1, close: price } });
const bullishSwings = () => [swing('h1', 'HIGH', 100, 1), swing('l1', 'LOW', 90, 3), swing('h2', 'HIGH', 110, 5), swing('l2', 'LOW', 95, 7)];
const bearishSwings = () => [swing('h1', 'HIGH', 110, 1), swing('l1', 'LOW', 100, 3), swing('h2', 'HIGH', 105, 5), swing('l2', 'LOW', 90, 7)];
const snapshots = (values: ConfirmedSwing[]): StructureSnapshot[] => reduceMarketStructure(values).snapshots as StructureSnapshot[];
const sweep = (id: string, direction: 'BUY_SIDE' | 'SELL_SIDE', minute: number, extreme: number): StructuralLiquiditySweepEvent => ({
  id, version: '1.0.0', direction, sourceType: 'ACCEPTED_STRUCTURE_SWING', sourceSwingId: direction === 'SELL_SIDE' ? 'l2' : 'h2', sourceSwingDirection: direction === 'SELL_SIDE' ? 'LOW' : 'HIGH', sourceSwingLabel: direction === 'SELL_SIDE' ? 'HL' : 'LH', sourcePrice: direction === 'SELL_SIDE' ? 95 : 105, sourcePivotAt: at(7), sourceConfirmedAt: at(8), sourceSnapshotId: 'snapshot', priorStructureBias: direction === 'SELL_SIDE' ? 'BULLISH' : 'BEARISH', sweepCandleIndex: minute, sweepOpenedAt: at(minute - 1), detectedAt: at(minute), open: 100, high: direction === 'BUY_SIDE' ? extreme : 101, low: direction === 'SELL_SIDE' ? extreme : 99, close: 100, excursionDistance: 1, excursionDistanceRelative: .01, excursionAtrMultiple: null, reclaimDistance: 1, wickLengthBeyondLevel: 1, closePositionRelativeToSource: 1, gapSweep: false, conflictingBosEventId: null, consumedSource: true, accepted: true, rejectionReason: null, evidence: [], fingerprint: id,
});
const gaps = (): FairValueGap[] => detectFairValueGapLifecycles({ candles: [candle(20, 94, 96, 90, 95), candle(21, 98, 101, 97, 100), candle(22, 103, 106, 102, 105)] }).gaps;
const config = (extra: Partial<StructuralStopCandidateConfig> = {}): Partial<StructuralStopCandidateConfig> => ({ enabledCandidateTypes: ['PROTECTED_SWING', 'LATEST_CONFIRMED_SWING', 'STRUCTURAL_INVALIDATION_LEVEL'], ...extra });
const run = (direction: 'FOR_LONG' | 'FOR_SHORT', values = direction === 'FOR_LONG' ? bullishSwings() : bearishSwings(), extra: Partial<Parameters<typeof generateStructuralStopCandidates>[0]> = {}) => generateStructuralStopCandidates({
  request: { direction, referencePrice: 100, referenceTimestamp: at(40) }, confirmedSwings: values, structureSnapshots: snapshots(values), config: config(), ...extra,
});

test('protected, structural invalidation, and latest swing candidates are objective and directional', () => {
  const long = run('FOR_LONG'), short = run('FOR_SHORT');
  assert.deepEqual(long.candidates.map((v) => [v.candidateType, v.rawInvalidationPrice]), [['PROTECTED_SWING', 95], ['STRUCTURAL_INVALIDATION_LEVEL', 95], ['LATEST_CONFIRMED_SWING', 95]]);
  assert.deepEqual(short.candidates.map((v) => [v.candidateType, v.rawInvalidationPrice]), [['PROTECTED_SWING', 105], ['STRUCTURAL_INVALIDATION_LEVEL', 105], ['LATEST_CONFIRMED_SWING', 105]]);
  assert.ok([...long.candidates, ...short.candidates].every((v) => v.evidence.at(-1)?.includes('not a final stop-loss recommendation')));
  assert.doesNotMatch(JSON.stringify(long), /recommendedStop|bestStop|positionSize|takeProfit|rewardToRisk|probability/i);
});

test('mixed and undefined structure never invent protected candidates', () => {
  const values = bullishSwings(), source = snapshots(values), mixed = { ...source.at(-1)!, bias: 'MIXED' as const }, undefinedSnapshot = { ...source.at(-1)!, id: 'undefined', bias: 'UNDEFINED' as const };
  for (const snapshot of [mixed, undefinedSnapshot]) {
    const result = run('FOR_LONG', values, { structureSnapshots: [snapshot], config: config({ enabledCandidateTypes: ['PROTECTED_SWING'] }) });
    assert.equal(result.candidates.length, 0); assert.ok(result.warnings.some((v) => v.includes('STRUCTURAL_CONTEXT_UNAVAILABLE')));
  }
});

test('latest confirmed policy uses only swings known by the reference timestamp', () => {
  const values = [...bullishSwings(), swing('future-low', 'LOW', 99, 50)];
  const result = run('FOR_LONG', values, { request: { direction: 'FOR_LONG', referencePrice: 100, referenceTimestamp: at(40) }, config: config({ enabledCandidateTypes: ['LATEST_CONFIRMED_SWING'], latestSwingPolicy: 'LATEST_CONFIRMED' }) });
  assert.equal(result.candidates[0]!.rawInvalidationPrice, 95); assert.deepEqual(result.candidates[0]!.sourceSwingIds, ['l2']);
});

test('explicit and all-relevant sweep extremes honor direction and reference time', () => {
  const values = bullishSwings(), before = sweep('before', 'SELL_SIDE', 30, 93), future = sweep('future', 'SELL_SIDE', 50, 92);
  const explicit = run('FOR_LONG', values, { sweepEvents: [before, future], request: { direction: 'FOR_LONG', referencePrice: 100, referenceTimestamp: at(40), sourceSweepEventId: 'before' }, config: config({ enabledCandidateTypes: ['SWEEP_EXTREME'], sweepSelectionPolicy: 'EXPLICIT_SOURCE_ONLY' }) });
  assert.equal(explicit.candidates[0]!.rawInvalidationPrice, 93);
  const missing = run('FOR_LONG', values, { sweepEvents: [before, future], request: { direction: 'FOR_LONG', referencePrice: 100, referenceTimestamp: at(40), sourceSweepEventId: 'future' }, config: config({ enabledCandidateTypes: ['SWEEP_EXTREME'], sweepSelectionPolicy: 'EXPLICIT_SOURCE_ONLY' }) });
  assert.equal(missing.candidates.length, 0); assert.ok(missing.warnings.some((v) => v.includes('EXPLICIT_SOURCE_NOT_FOUND')));
  const wrong = run('FOR_LONG', values, { sweepEvents: [sweep('buy', 'BUY_SIDE', 30, 107)], config: config({ enabledCandidateTypes: ['SWEEP_EXTREME'], sweepSelectionPolicy: 'ALL_RELEVANT' }) });
  assert.equal(wrong.candidates.length, 0);
});

test('FVG far boundary uses historical status and correct directional gap only', () => {
  const gap = gaps()[0]!, terminalLater = { ...gap, status: 'INVALIDATED' as const, invalidatedAt: at(50) };
  const historical = run('FOR_LONG', bullishSwings(), { fairValueGaps: [terminalLater], request: { direction: 'FOR_LONG', referencePrice: 110, referenceTimestamp: at(40), sourceFvgId: gap.id }, config: config({ enabledCandidateTypes: ['FVG_FAR_BOUNDARY'], fvgSelectionPolicy: 'EXPLICIT_SOURCE_ONLY' }) });
  assert.equal(historical.candidates[0]!.rawInvalidationPrice, gap.lowerBound);
  const after = run('FOR_LONG', bullishSwings(), { fairValueGaps: [terminalLater], request: { direction: 'FOR_LONG', referencePrice: 110, referenceTimestamp: at(60), sourceFvgId: gap.id }, config: config({ enabledCandidateTypes: ['FVG_FAR_BOUNDARY'], fvgSelectionPolicy: 'EXPLICIT_SOURCE_ONLY' }) });
  assert.equal(after.candidates.length, 0);
  const wrongDirection = run('FOR_SHORT', bearishSwings(), { fairValueGaps: [gap], request: { direction: 'FOR_SHORT', referencePrice: 90, referenceTimestamp: at(40), sourceFvgId: gap.id }, config: config({ enabledCandidateTypes: ['FVG_FAR_BOUNDARY'] }) });
  assert.equal(wrongDirection.candidates.length, 0);
});

test('absolute and relative buffers apply away from market and invalid-side equality is explicit', () => {
  const absolute = run('FOR_LONG', bullishSwings(), { config: config({ enabledCandidateTypes: ['LATEST_CONFIRMED_SWING'], bufferPolicy: 'ABSOLUTE', absoluteBuffer: 2 }) });
  assert.deepEqual([absolute.candidates[0]!.effectiveStopPrice, absolute.candidates[0]!.appliedBuffer], [93, 2]);
  const relative = run('FOR_SHORT', bearishSwings(), { config: config({ enabledCandidateTypes: ['LATEST_CONFIRMED_SWING'], bufferPolicy: 'RELATIVE', relativeBuffer: .01 }) });
  assert.equal(relative.candidates[0]!.effectiveStopPrice, 106.05);
  const equal = run('FOR_LONG', [swing('low', 'LOW', 100, 1)], { structureSnapshots: [], config: config({ enabledCandidateTypes: ['LATEST_CONFIRMED_SWING'], latestSwingPolicy: 'LATEST_CONFIRMED' }) });
  assert.equal(equal.rejectedCandidates[0]!.rejectionReason, 'STOP_NOT_BELOW_REFERENCE_FOR_LONG');
  assert.throws(() => run('FOR_LONG', bullishSwings(), { config: config({ absoluteBuffer: -1 }) }), StructuralStopCandidateError);
});

test('ATR buffers are replay-safe and unavailable ATR rejects explicitly', () => {
  const history = Array.from({ length: 15 }, (_, i) => candle(i + 10, 100, 102, 98, 100));
  const result = run('FOR_LONG', bullishSwings(), { candles: history, config: config({ enabledCandidateTypes: ['LATEST_CONFIRMED_SWING'], bufferPolicy: 'ATR', atrBufferMultiple: .5, atrPeriod: 14 }) });
  assert.equal(result.candidates[0]!.appliedBuffer, 2); assert.equal(result.candidates[0]!.effectiveStopPrice, 93);
  const missing = run('FOR_LONG', bullishSwings(), { candles: history.slice(0, 14), config: config({ enabledCandidateTypes: ['LATEST_CONFIRMED_SWING'], bufferPolicy: 'ATR', atrBufferMultiple: .5, atrPeriod: 14 }) });
  assert.equal(missing.rejectedCandidates[0]!.rejectionReason, 'ATR_UNAVAILABLE');
});

test('KEEP_ALL, deterministic merging, ranking, limits, IDs, and serialization are stable', () => {
  const keep = run('FOR_LONG');
  assert.equal(keep.candidates.length, 3);
  const merged = run('FOR_LONG', bullishSwings(), { config: config({ deduplicationPolicy: 'MERGE_SAME_EFFECTIVE_PRICE' }) });
  assert.equal(merged.candidates.length, 1); assert.deepEqual(merged.candidates[0]!.sourceCandidateTypes, ['PROTECTED_SWING', 'STRUCTURAL_INVALIDATION_LEVEL', 'LATEST_CONFIRMED_SWING']);
  const distance = run('FOR_LONG', bullishSwings(), { config: config({ rankingMode: 'DISTANCE', maximumCandidateCount: 2 }) });
  assert.equal(distance.candidates.length, 2); assert.deepEqual(distance.candidates.map((v) => v.rank), [1, 2]);
  assert.equal(serializeStructuralStopCandidateResult(keep), serializeStructuralStopCandidateResult(run('FOR_LONG')));
  assert.ok(Object.isFrozen(keep) && Object.isFrozen(keep.candidates[0]));
});

test('stateful queries equal batch, remain historical after future inputs, reject duplicates/order, and reset', () => {
  const values = bullishSwings(), sourceSnapshots = snapshots(values), generator = createStructuralStopCandidateGenerator(config());
  values.forEach((v) => generator.pushConfirmedSwing(v)); sourceSnapshots.forEach((v) => generator.pushStructureSnapshot(v));
  const request = { direction: 'FOR_LONG' as const, referencePrice: 100, referenceTimestamp: at(40) };
  const before = generator.generateCandidates(request), batch = run('FOR_LONG');
  assert.equal(JSON.stringify(before), JSON.stringify(batch));
  generator.pushConfirmedSwing(swing('future', 'LOW', 99, 50));
  assert.equal(JSON.stringify(generator.generateCandidates(request)), JSON.stringify(before));
  assert.throws(() => generator.pushConfirmedSwing(swing('future', 'LOW', 99, 50)), /Duplicate/);
  assert.throws(() => generator.pushConfirmedSwing(swing('old', 'LOW', 80, 2)), /retroactively|move backward/);
  generator.reset(); assert.equal(generator.generateCandidates(request).candidates.length, 0);
});

test('module imports no AI, routes, execution, strategy, backtesting, clock, or randomness', () => {
  const source = readFileSync(new URL('../lib/market-intelligence/risk/structural-stop-candidates/structural-stop-candidate-generator.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"].*(\/ai\/|\/app\/|\/routes?\/|\/execution\/|\/strateg(?:y|ies)\/|\/backtesting\/)/i);
  assert.doesNotMatch(source, /Date\.now|Math\.random|randomUUID|crypto\.randomUUID/);
});
