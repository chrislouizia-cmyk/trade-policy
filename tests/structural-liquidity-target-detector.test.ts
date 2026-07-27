import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import type { ConfirmedSwing, SwingDirection } from '../lib/market-intelligence/detectors/confirmed-swing/confirmed-swing-types.ts';
import { detectStructuralLiquiditySweeps } from '../lib/market-intelligence/liquidity/structural-sweep/index.ts';
import type { StructuralLiquiditySweepEvent } from '../lib/market-intelligence/liquidity/structural-sweep/structural-liquidity-sweep-types.ts';
import { createStructuralLiquidityTargetDetector, detectStructuralLiquidityTargets, rankAvailableLiquidityTargets, serializeStructuralLiquidityTargetResult, StructuralLiquidityTargetError, type StructuralLiquidityTargetConfig } from '../lib/market-intelligence/liquidity/targets/index.ts';
import { detectBreaksOfStructure } from '../lib/market-intelligence/structure/break-of-structure/index.ts';
import type { BreakOfStructureEvent } from '../lib/market-intelligence/structure/break-of-structure/break-of-structure-types.ts';
import { reduceMarketStructure, type StructureSnapshot } from '../lib/market-intelligence/structure/index.ts';

const at = (minute: number): string => new Date(Date.UTC(2024, 0, 1, 0, minute)).toISOString();
const swing = (id: string, direction: SwingDirection, price: number, pivot: number, confirmed: number): ConfirmedSwing => ({
  id, direction, pivotIndex: pivot / 15, confirmedIndex: confirmed / 15, pivotAt: at(pivot), confirmedAt: at(confirmed), price,
  leftBars: 2, rightBars: 2, prominence: 2, prominenceAtrMultiple: null, strength: .2, equalPriceConflict: false,
  sourceCandle: { open: price, high: direction === 'HIGH' ? price : price + 1, low: direction === 'LOW' ? price : price - 1, close: price },
});
const candle = (minute: number, open: number, high: number, low: number, close: number, complete = true): NormalizedCandle => ({
  openedAt: at(minute), closedAt: at(minute + 15), open, high, low, close, volume: 100, complete,
});
const baseLevels = () => [
  swing('h1', 'HIGH', 100, 0, 15), swing('l1', 'LOW', 90, 15, 30),
  swing('h2', 'HIGH', 110, 30, 45), swing('l2', 'LOW', 95, 45, 60),
];
const snapshots = (values: readonly ConfirmedSwing[]): readonly StructureSnapshot[] => reduceMarketStructure(values).snapshots;
const run = (values = baseLevels(), candles: readonly NormalizedCandle[] = [], config: Partial<StructuralLiquidityTargetConfig> = {}, sourceSnapshots = snapshots(values), bosEvents: readonly BreakOfStructureEvent[] = [], sweepEvents: readonly StructuralLiquiditySweepEvent[] = []) =>
  detectStructuralLiquidityTargets({ candles, confirmedSwings: values, structureSnapshots: sourceSnapshots, bosEvents, sweepEvents, config });

test('creates buy-side and sell-side targets only from accepted confirmed structure', () => {
  const result = run();
  const high = result.targets.find((target) => target.sourceSwingIds.includes('h2') && target.targetType === 'STRUCTURAL_HIGH')!;
  const low = result.targets.find((target) => target.sourceSwingIds.includes('l2') && target.targetType === 'STRUCTURAL_LOW')!;
  assert.deepEqual({ side: high.side, price: high.price, label: high.sourceSwingLabels[0] }, { side: 'BUY_SIDE', price: 110, label: 'HH' });
  assert.deepEqual({ side: low.side, price: low.price, label: low.sourceSwingLabels[0] }, { side: 'SELL_SIDE', price: 95, label: 'HL' });
  const unclassified = swing('raw', 'HIGH', 120, 60, 75);
  assert.equal(run([...baseLevels(), unclassified], [], {}, snapshots(baseLevels())).targets.some((target) => target.sourceSwingIds.includes('raw')), false);
});

test('label eligibility and source policy are explicit', () => {
  const onlyInitial = run(baseLevels(), [], { allowedHighLabels: ['INITIAL_HIGH'], clusterPolicy: 'INDIVIDUAL_ONLY' });
  assert.deepEqual(onlyInitial.targets.filter((target) => target.side === 'BUY_SIDE').map((target) => target.sourceSwingLabels[0]), ['INITIAL_HIGH']);
  const latest = run(baseLevels(), [], { sourceEligibility: 'LATEST_PER_DIRECTION', clusterPolicy: 'INDIVIDUAL_ONLY' });
  assert.deepEqual(latest.targets.map((target) => target.sourceSwingIds[0]).sort(), ['h2', 'l2']);
});

test('equal-high and equal-low clusters require chronological minimum membership', () => {
  const values = [
    swing('h1', 'HIGH', 100, 0, 15), swing('l1', 'LOW', 90, 15, 30),
    swing('h2', 'HIGH', 100, 30, 45), swing('l2', 'LOW', 90, 45, 60),
  ];
  const oneHigh = run(values.slice(0, 2), [], { clusterPolicy: 'CLUSTER_ONLY' });
  assert.equal(oneHigh.targets.length, 0);
  const result = run(values, [], { clusterPolicy: 'CLUSTER_ONLY' });
  const highs = result.targets.find((target) => target.targetType === 'EQUAL_HIGHS')!, lows = result.targets.find((target) => target.targetType === 'EQUAL_LOWS')!;
  assert.equal(highs.memberCount, 2);
  assert.equal(highs.detectedAt, at(45));
  assert.equal(lows.detectedAt, at(60));
});

test('equality tolerance, cluster price, and third-member updates are deterministic', () => {
  const values = [
    swing('h1', 'HIGH', 100, 0, 15), swing('l1', 'LOW', 90, 15, 30),
    swing('h2', 'HIGH', 100.1, 30, 45), swing('l2', 'LOW', 92, 45, 60),
    swing('h3', 'HIGH', 99.9, 60, 75),
  ];
  assert.equal(run(values, [], { clusterPolicy: 'CLUSTER_ONLY' }).targets.some((target) => target.targetType === 'EQUAL_HIGHS'), false);
  const two = run(values.slice(0, 4), [], { clusterPolicy: 'CLUSTER_ONLY', equalityToleranceAbsolute: .2 });
  const three = run(values, [], { clusterPolicy: 'CLUSTER_ONLY', equalityToleranceAbsolute: .2 });
  const first = two.targets.find((target) => target.targetType === 'EQUAL_HIGHS')!, expanded = three.targets.find((target) => target.targetType === 'EQUAL_HIGHS')!;
  assert.equal(expanded.id, first.id);
  assert.equal(expanded.memberCount, 3);
  assert.equal(expanded.price, 100);
  assert.equal(three.lifecycleEvents.filter((event) => event.targetId === expanded.id && event.eventType === 'MEMBER_ADDED').length, 1);
});

test('individual and cluster policies expose exactly the configured facts', () => {
  const values = [swing('h1', 'HIGH', 100, 0, 15), swing('l1', 'LOW', 90, 15, 30), swing('h2', 'HIGH', 100, 30, 45)];
  assert.ok(run(values, [], { clusterPolicy: 'KEEP_INDIVIDUAL_AND_CLUSTER' }).targets.some((target) => target.targetType === 'EQUAL_HIGHS'));
  assert.ok(run(values, [], { clusterPolicy: 'INDIVIDUAL_ONLY' }).targets.every((target) => !target.targetType.startsWith('EQUAL')));
  assert.ok(run(values, [], { clusterPolicy: 'CLUSTER_ONLY' }).targets.every((target) => target.targetType.startsWith('EQUAL')));
});

test('TESTED occurs once, only after target confirmation, and never on creation candle', () => {
  const result = run(baseLevels(), [candle(45, 105, 111, 104, 108), candle(75, 108, 112, 107, 109), candle(90, 109, 113, 108, 110)]);
  const target = result.targets.find((value) => value.sourceSwingIds[0] === 'h2' && value.memberCount === 1)!;
  assert.equal(target.firstTestedAt, at(90));
  assert.equal(result.lifecycleEvents.filter((event) => event.targetId === target.id && event.eventType === 'TESTED').length, 1);
});

test('accepted matching BOS breaks individual and complete cluster targets only', () => {
  const values = baseLevels(), sourceSnapshots = snapshots(values), eventCandle = candle(75, 109, 115, 108, 111);
  const bos = detectBreaksOfStructure({ candles: [eventCandle], confirmedSwings: values, structureSnapshots: sourceSnapshots }).events[0]!;
  const result = run(values, [], {}, sourceSnapshots, [bos]);
  assert.equal(result.targets.find((target) => target.sourceSwingIds[0] === 'h2' && target.memberCount === 1)!.status, 'BROKEN');
  assert.ok(result.targets.filter((target) => !target.sourceSwingIds.includes('h2')).every((target) => target.status !== 'BROKEN'));
  const invalidated = run(values, [], { bosConsumptionPolicy: 'MARK_INVALIDATED' }, sourceSnapshots, [bos]);
  assert.equal(invalidated.targets.find((target) => target.sourceSwingIds[0] === 'h2' && target.memberCount === 1)!.status, 'INVALIDATED');
});

test('accepted matching sweep consumes targets while unrelated and partial cluster sweeps do not', () => {
  const values = baseLevels(), sourceSnapshots = snapshots(values), eventCandle = candle(75, 109, 112, 108, 109);
  const sweep = detectStructuralLiquiditySweeps({ candles: [eventCandle], confirmedSwings: values, structureSnapshots: sourceSnapshots }).events[0]!;
  const result = run(values, [], {}, sourceSnapshots, [], [sweep]);
  assert.equal(result.targets.find((target) => target.sourceSwingIds[0] === 'h2' && target.memberCount === 1)!.status, 'SWEPT');
  assert.ok(result.targets.filter((target) => !target.sourceSwingIds.includes('h2')).every((target) => target.status !== 'SWEPT'));
  const kept = run(values, [], { sweepConsumptionPolicy: 'KEEP_AVAILABLE_AFTER_SWEEP' }, sourceSnapshots, [], [sweep]);
  assert.notEqual(kept.targets.find((target) => target.sourceSwingIds[0] === 'h2' && target.memberCount === 1)!.status, 'SWEPT');
});

test('BOS outranks sweep at the same timestamp and terminal targets never evolve', () => {
  const values = baseLevels(), sourceSnapshots = snapshots(values);
  const bosCandle = candle(75, 109, 115, 108, 111), bos = detectBreaksOfStructure({ candles: [bosCandle], confirmedSwings: values, structureSnapshots: sourceSnapshots }).events[0]!;
  const sweep = detectStructuralLiquiditySweeps({ candles: [candle(75, 109, 112, 108, 109)], confirmedSwings: values, structureSnapshots: sourceSnapshots }).events[0]!;
  const result = run(values, [candle(90, 109, 115, 108, 110)], {}, sourceSnapshots, [bos], [sweep]);
  const target = result.targets.find((value) => value.sourceSwingIds[0] === 'h2' && value.memberCount === 1)!;
  assert.equal(target.status, 'BROKEN');
  assert.deepEqual(target.consumingSweepEventIds, []);
  assert.equal(target.firstTestedAt, null);
});

test('replacement policy preserves history and explicitly invalidates superseded latest', () => {
  const keep = run(baseLevels(), [], { clusterPolicy: 'INDIVIDUAL_ONLY', structuralReplacementPolicy: 'KEEP_ALL_HISTORY' });
  assert.ok(keep.targets.filter((target) => target.side === 'BUY_SIDE').every((target) => target.status === 'AVAILABLE'));
  const replace = run(baseLevels(), [], { clusterPolicy: 'INDIVIDUAL_ONLY', structuralReplacementPolicy: 'INVALIDATE_SUPERSEDED_LATEST' });
  assert.equal(replace.targets.find((target) => target.sourceSwingIds[0] === 'h1')!.status, 'INVALIDATED');
  assert.equal(replace.targets.find((target) => target.sourceSwingIds[0] === 'h2')!.status, 'AVAILABLE');
});

test('expiration uses exact completed-candle count or timestamp and NEVER remains available', () => {
  const future = candle(75, 105, 106, 104, 105);
  assert.notEqual(run(baseLevels(), [future], { expirationPolicy: 'NEVER' }).targets.find((target) => target.sourceSwingIds[0] === 'h2')!.status, 'EXPIRED');
  assert.equal(run(baseLevels(), [future], { expirationPolicy: 'AFTER_N_CANDLES', expirationCandles: 1 }).targets.find((target) => target.sourceSwingIds[0] === 'h2')!.status, 'EXPIRED');
  assert.equal(run(baseLevels(), [future], { expirationPolicy: 'AFTER_N_MILLISECONDS', expirationMilliseconds: 45 * 60_000 }).targets.find((target) => target.sourceSwingIds[0] === 'h2')!.status, 'EXPIRED');
});

test('absolute, relative, and ATR ranking remain neutral and deterministic', () => {
  const result = run(), referenceTimestamp = at(120);
  const absolute = rankAvailableLiquidityTargets({ targets: result.targets, referencePrice: 102, referenceTimestamp, side: 'BUY_SIDE' });
  assert.ok(absolute[0]!.absoluteDistance <= absolute.at(-1)!.absoluteDistance);
  const relative = rankAvailableLiquidityTargets({ targets: result.targets, referencePrice: 102, referenceTimestamp, side: 'BUY_SIDE', mode: 'RELATIVE_DISTANCE' });
  assert.equal(relative[0]!.targetId, absolute[0]!.targetId);
  const atr = rankAvailableLiquidityTargets({ targets: result.targets, referencePrice: 102, referenceTimestamp, side: 'BUY_SIDE', mode: 'ATR_NORMALIZED_DISTANCE', atrValue: 2 });
  assert.equal(atr[0]!.atrNormalizedDistance, atr[0]!.absoluteDistance / 2);
  assert.deepEqual(rankAvailableLiquidityTargets({ targets: result.targets, referencePrice: 102, referenceTimestamp, mode: 'ATR_NORMALIZED_DISTANCE' }), []);
  assert.doesNotMatch(JSON.stringify(absolute), /take.?profit|reward|risk|probability|tradeDirection/i);
});

test('batch normalizes inputs and incremental output is byte-identical', () => {
  const values = baseLevels(), sourceSnapshots = snapshots(values), eventCandle = candle(75, 105, 111, 104, 108);
  const batch = run([...values].reverse(), [eventCandle], {}, [...sourceSnapshots].reverse());
  const incremental = createStructuralLiquidityTargetDetector();
  values.forEach((value) => incremental.pushConfirmedSwing(value));
  sourceSnapshots.forEach((value) => incremental.pushStructureSnapshot(value));
  incremental.pushCandle(eventCandle);
  assert.equal(JSON.stringify(incremental.getResult()), JSON.stringify(batch));
  assert.ok(incremental.getNewLifecycleEvents().length > 0);
  assert.deepEqual(incremental.getNewLifecycleEvents(), []);
});

test('duplicates, invalid candles, incomplete candles, time travel, and reset are explicit', () => {
  const values = baseLevels(), sourceSnapshots = snapshots(values);
  assert.throws(() => run([values[0]!, values[0]!], [], {}, []), (error) => error instanceof StructuralLiquidityTargetError && error.code === 'DUPLICATE_SWING_ID');
  assert.throws(() => run(values, [], {}, [sourceSnapshots[0]!, sourceSnapshots[0]!]), /duplicate ID/i);
  const duplicate = candle(75, 100, 101, 99, 100);
  assert.throws(() => run(values, [duplicate, duplicate]), /Duplicate candle/);
  assert.throws(() => run(values, [{ ...duplicate, high: 90 }]), /contain.*OHLC|geometry/i);
  assert.match(run(values, [candle(75, 100, 101, 99, 100, false)]).warnings[0]!, /Ignored incomplete/);
  const incremental = createStructuralLiquidityTargetDetector();
  incremental.pushConfirmedSwing(values[0]!);
  incremental.pushCandle(candle(75, 100, 101, 99, 100));
  assert.throws(() => incremental.pushConfirmedSwing(values[1]!), /processed history/);
  assert.throws(() => incremental.pushCandle(candle(60, 100, 101, 99, 100)), /ascending/);
  incremental.reset();
  assert.deepEqual(incremental.getAllTargets(), []);
});

test('stable IDs, lifecycle IDs, evidence, serialization, and future-input history are deterministic', () => {
  const first = run(), second = run(structuredClone(baseLevels()));
  assert.equal(first.targets[0]!.id, second.targets[0]!.id);
  assert.equal(first.lifecycleEvents[0]!.id, second.lifecycleEvents[0]!.id);
  assert.equal(serializeStructuralLiquidityTargetResult(first), serializeStructuralLiquidityTargetResult(second));
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.targets[0]!.evidence));
  assert.match(first.targets[0]!.evidence.at(-1)!, /not a take-profit recommendation/);
  const expanded = run([...baseLevels(), swing('future-high', 'HIGH', 120, 75, 90)]);
  assert.deepEqual(expanded.lifecycleEvents.slice(0, first.lifecycleEvents.length), first.lifecycleEvents);
});

test('module has no recalculation, AI, strategy, route, or backtesting dependency', () => {
  const source = readFileSync('lib/market-intelligence/liquidity/targets/structural-liquidity-target-detector.ts', 'utf8');
  assert.doesNotMatch(source, new RegExp('openai|anthropic|prompt|strategy|backtesting|app/api|Date[.]now|Math[.]random|randomUUID', 'i'));
  assert.doesNotMatch(source, /detectConfirmedSwings|reduceMarketStructure|detectBreaksOfStructure|detectStructuralLiquiditySweeps|classifyMarketStructureTransitions/);
});

test('research audit upgrades targets only and keeps structural stop placement blocked', () => {
  const audit = readFileSync('research/strategies/xauusd-structure-pullback/1.0.0/detector-dependency-audit.md', 'utf8');
  assert.match(audit, /\| Liquidity target detection \| SUPPORTED \| `structural-liquidity-target@1\.0\.0`/);
  assert.match(audit, /\| Structural stop placement \| UNSUPPORTED \|/);
  assert.match(audit, /Conclusion: `DETECTOR_IMPLEMENTATION_REQUIRED`/);
});
