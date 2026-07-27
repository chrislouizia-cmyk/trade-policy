import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import type { ConfirmedSwing, SwingDirection } from '../lib/market-intelligence/detectors/confirmed-swing/confirmed-swing-types.ts';
import { createBreakOfStructureDetector, detectBreaksOfStructure, serializeBreakOfStructureResult, type BreakOfStructureConfig, BreakOfStructureDetectionError } from '../lib/market-intelligence/structure/break-of-structure/index.ts';
import { reduceMarketStructure, type StructureSnapshot } from '../lib/market-intelligence/structure/index.ts';

const at = (minute: number): string => new Date(Date.UTC(2024, 0, 1, 0, minute)).toISOString();
const swing = (id: string, direction: SwingDirection, price: number, pivotMinute: number, confirmedMinute: number): ConfirmedSwing => ({
  id,
  direction,
  pivotIndex: pivotMinute / 15,
  confirmedIndex: confirmedMinute / 15,
  pivotAt: at(pivotMinute),
  confirmedAt: at(confirmedMinute),
  price,
  leftBars: 2,
  rightBars: 2,
  prominence: 2,
  prominenceAtrMultiple: null,
  strength: .2,
  equalPriceConflict: false,
  sourceCandle: { open: price, high: direction === 'HIGH' ? price : price + 1, low: direction === 'LOW' ? price : price - 1, close: price },
});
const candle = (openedMinute: number, open: number, high: number, low: number, close: number, complete = true): NormalizedCandle => ({
  openedAt: at(openedMinute),
  closedAt: at(openedMinute + 15),
  open,
  high,
  low,
  close,
  volume: 100,
  complete,
});
const snapshots = (swings: readonly ConfirmedSwing[], config = {}): readonly StructureSnapshot[] => reduceMarketStructure(swings, config).snapshots;
const run = (candles: readonly NormalizedCandle[], swings: readonly ConfirmedSwing[], config: Partial<BreakOfStructureConfig> = {}, sourceSnapshots = snapshots(swings)) => detectBreaksOfStructure({ candles, confirmedSwings: swings, structureSnapshots: sourceSnapshots, config });

test('detects basic bullish and bearish BOS only from completed candle closes', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  const bullish = run([candle(45, 99, 105, 98, 101)], [high]);
  assert.equal(bullish.events.length, 1);
  assert.deepEqual({ direction: bullish.events[0]!.direction, sourceSwingId: bullish.events[0]!.sourceSwingId, detectedAt: bullish.events[0]!.detectedAt }, { direction: 'BULLISH', sourceSwingId: 'high', detectedAt: at(60) });
  const low = swing('low', 'LOW', 90, 0, 30);
  const bearish = run([candle(45, 91, 92, 85, 89)], [low]);
  assert.equal(bearish.events[0]!.direction, 'BEARISH');
  assert.equal(bearish.events[0]!.breakDistance, 1);
});

test('wick-only breaks, equal closes, and closes inside tolerance never trigger BOS', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  assert.equal(run([candle(45, 99, 105, 98, 100)], [high]).events.length, 0);
  assert.equal(run([candle(45, 99, 105, 98, 99)], [high]).events.length, 0);
  const low = swing('low', 'LOW', 90, 0, 30);
  assert.equal(run([candle(45, 91, 92, 85, 90)], [low]).events.length, 0);
  assert.equal(run([candle(45, 91, 92, 85, 91)], [low]).events.length, 0);
});

test('absolute and relative close tolerances use strict boundaries', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  assert.equal(run([candle(45, 100, 102, 99, 101)], [high], { closeToleranceAbsolute: 1 }).events.length, 0);
  assert.equal(run([candle(45, 100, 102, 99, 101.01)], [high], { closeToleranceAbsolute: 1 }).events.length, 1);
  assert.equal(run([candle(45, 100, 102, 99, 101)], [high], { closeToleranceRelative: .01 }).events.length, 0);
  assert.equal(run([candle(45, 100, 102, 99, 101.01)], [high], { closeToleranceRelative: .01 }).events.length, 1);
});

test('source swing and snapshot must exist no later than breakout openedAt', () => {
  const during = swing('during', 'HIGH', 100, 15, 60);
  const lateSnapshot = snapshots([during]);
  assert.equal(run([candle(45, 99, 105, 98, 101)], [during], {}, lateSnapshot).events.length, 0);
  const before = swing('before', 'HIGH', 100, 0, 45);
  const eligible = run([candle(45, 99, 105, 98, 101)], [before]);
  assert.equal(eligible.events.length, 1);
  assert.equal(eligible.events[0]!.sourceConfirmedAt, at(45));
});

test('missing snapshots or missing explicit confirmed swings fail conservatively', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  const breakout = candle(45, 99, 105, 98, 101);
  const noSnapshot = run([breakout], [high], {}, []);
  assert.deepEqual(noSnapshot.events, []);
  assert.match(noSnapshot.warnings[0]!, /cannot produce BOS without structure state/);
  const snapshotOnly = detectBreaksOfStructure({ candles: [breakout], confirmedSwings: [], structureSnapshots: snapshots([high]) });
  assert.deepEqual(snapshotOnly.events, []);
});

test('event visibility is fixed at candle closedAt and cannot use an incomplete candle', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  const incomplete = run([candle(45, 99, 105, 98, 101, false)], [high]);
  assert.deepEqual(incomplete.events, []);
  assert.match(incomplete.warnings[0]!, /Ignored incomplete candle/);
  const event = run([candle(45, 99, 105, 98, 101)], [high]).events[0]!;
  assert.equal(event.detectedAt, at(60));
  assert.notEqual(event.detectedAt, event.breakoutOpenedAt);
});

test('LATEST_ACCEPTED_STRUCTURE and LATEST_CONFIRMED remain explicit', () => {
  const first = swing('accepted-high', 'HIGH', 100, 0, 30);
  const rejected = swing('rejected-high', 'HIGH', 110, 15, 45);
  const structure = snapshots([first, rejected], { sameDirectionReplacementPolicy: 'KEEP_FIRST' });
  const breakout = candle(60, 99, 106, 98, 105);
  assert.equal(run([breakout], [first, rejected], { swingEligibility: 'LATEST_ACCEPTED_STRUCTURE' }, structure).events[0]!.sourceSwingId, 'accepted-high');
  assert.equal(run([breakout], [first, rejected], { swingEligibility: 'LATEST_CONFIRMED' }, structure).events.length, 0);
  const acceptedStructure = snapshots([first]);
  assert.equal(run([breakout], [first], { swingEligibility: 'LATEST_CONFIRMED' }, acceptedStructure).events[0]!.sourceSwingId, 'accepted-high');
});

test('ALL_UNBROKEN_ACCEPTED can break several levels in deterministic order', () => {
  const older = swing('older-high', 'HIGH', 90, 0, 30);
  const newer = swing('newer-high', 'HIGH', 100, 15, 45);
  const result = run([candle(60, 89, 106, 88, 105)], [newer, older], { swingEligibility: 'ALL_UNBROKEN_ACCEPTED' });
  assert.deepEqual(result.events.map((event) => event.sourceSwingId), ['older-high', 'newer-high']);
  assert.ok(result.events.every((event) => event.breakoutCandleIndex === 0));
});

test('default duplicate policy emits only once per source swing', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  const result = run([candle(45, 99, 103, 98, 101), candle(60, 101, 104, 100, 102)], [high]);
  assert.equal(result.events.length, 1);
});

test('rebreak requires a later completed close back inside before another break', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  const result = run([
    candle(45, 99, 103, 98, 101),
    candle(60, 101, 104, 100, 102),
    candle(75, 102, 103, 98, 99),
    candle(90, 99, 104, 98, 101),
  ], [high], { duplicateBreakPolicy: 'ALLOW_REBREAK_AFTER_CLOSE_BACK_INSIDE' });
  assert.deepEqual(result.events.map((event) => event.breakoutOpenedAt), [at(45), at(90)]);
});

test('rebreak reactivation requires close back inside the raw level, not merely its tolerance band', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  const result = run([
    candle(45, 100, 103, 99, 102),
    candle(60, 102, 103, 100, 100.5),
    candle(75, 100.5, 103, 100, 102),
    candle(90, 102, 103, 98, 99.9),
    candle(105, 100, 104, 99, 102),
  ], [high], { duplicateBreakPolicy: 'ALLOW_REBREAK_AFTER_CLOSE_BACK_INSIDE', closeToleranceAbsolute: 1 });
  assert.deepEqual(result.events.map((event) => event.breakoutOpenedAt), [at(45), at(105)]);
});

test('gap policy allows or rejects an otherwise valid close break', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  const gap = candle(45, 101, 104, 100.5, 102);
  const allowed = run([gap], [high], { gapBreakPolicy: 'ALLOW' });
  assert.equal(allowed.events[0]!.gapBreak, true);
  const rejected = run([gap], [high], { gapBreakPolicy: 'REJECT' });
  assert.equal(rejected.events.length, 0);
  assert.equal(rejected.rejectedCandidates[0]!.rejectionReason, 'GAP_BREAK_REJECTED');
});

function bullishStructure(): { swings: ConfirmedSwing[]; snapshots: readonly StructureSnapshot[]; nextMinute: number } {
  const values = [
    swing('h1', 'HIGH', 100, 0, 30),
    swing('l1', 'LOW', 90, 15, 45),
    swing('h2', 'HIGH', 110, 30, 60),
    swing('l2', 'LOW', 95, 45, 75),
  ];
  return { swings: values, snapshots: snapshots(values), nextMinute: 90 };
}
function bearishStructure(): { swings: ConfirmedSwing[]; snapshots: readonly StructureSnapshot[]; nextMinute: number } {
  const values = [
    swing('h1', 'HIGH', 100, 0, 30),
    swing('l1', 'LOW', 90, 15, 45),
    swing('h2', 'HIGH', 95, 30, 60),
    swing('l2', 'LOW', 85, 45, 75),
  ];
  return { swings: values, snapshots: snapshots(values), nextMinute: 90 };
}

test('CONTINUATION_ONLY accepts aligned bullish and bearish BOS', () => {
  const bullish = bullishStructure();
  const bull = run([candle(bullish.nextMinute, 109, 115, 108, 111)], bullish.swings, { requireDirectionalBias: 'CONTINUATION_ONLY' }, bullish.snapshots);
  assert.equal(bull.events[0]!.continuationContext, 'CONTINUATION');
  const bearish = bearishStructure();
  const bear = run([candle(bearish.nextMinute, 86, 87, 80, 84)], bearish.swings, { requireDirectionalBias: 'CONTINUATION_ONLY' }, bearish.snapshots);
  assert.equal(bear.events[0]!.continuationContext, 'CONTINUATION');
});

test('continuation filter rejects counter/undefined while NONE accepts structural breaks', () => {
  const bullish = bullishStructure();
  const counterCandle = candle(bullish.nextMinute, 96, 97, 88, 89);
  const rejected = run([counterCandle], bullish.swings, { requireDirectionalBias: 'CONTINUATION_ONLY' }, bullish.snapshots);
  assert.equal(rejected.rejectedCandidates[0]!.rejectionReason, 'COUNTER_STRUCTURE_OR_UNDEFINED');
  assert.equal(rejected.rejectedCandidates[0]!.continuationContext, 'COUNTER_STRUCTURE');
  assert.equal(run([counterCandle], bullish.swings, { requireDirectionalBias: 'NONE' }, bullish.snapshots).events.length, 1);
  const initial = swing('initial', 'HIGH', 100, 0, 30);
  assert.equal(run([candle(45, 99, 105, 98, 101)], [initial], { requireDirectionalBias: 'CONTINUATION_ONLY' }).rejectedCandidates[0]!.continuationContext, 'UNDEFINED');
});

test('stable fingerprints, evidence, and serialization are deterministic', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  const first = run([candle(45, 99, 105, 98, 101)], [high]);
  const second = run([candle(45, 99, 105, 98, 101)], [structuredClone(high)]);
  assert.equal(first.events[0]!.id, second.events[0]!.id);
  assert.equal(first.events[0]!.fingerprint, second.events[0]!.fingerprint);
  assert.equal(serializeBreakOfStructureResult(first), serializeBreakOfStructureResult(second));
  assert.deepEqual(first.events[0]!.evidence, [
    'Bullish BOS: candle close 101 exceeded confirmed INITIAL_HIGH level 100 by 1.',
    `Source swing was confirmed at ${at(30)} before breakout candle opened at ${at(45)}.`,
    'Prior structure bias was UNDEFINED.',
    `Event emitted at breakout candle close ${at(60)}.`,
  ]);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.events[0]!.evidence));
});

test('batch and incremental APIs are byte-identical', () => {
  const structure = bullishStructure();
  const candles = [candle(90, 109, 115, 108, 111), candle(105, 111, 112, 109, 110)];
  const batch = run(candles, structure.swings, {}, structure.snapshots);
  const incremental = createBreakOfStructureDetector();
  structure.swings.forEach((value) => incremental.pushConfirmedSwing(value));
  structure.snapshots.forEach((value) => incremental.pushStructureSnapshot(value));
  candles.forEach((value) => incremental.pushCandle(value));
  assert.equal(JSON.stringify(incremental.getResult()), JSON.stringify(batch));
  assert.equal(incremental.getNewEvents().length, 0, 'the last non-breaking candle replaces the per-push new-event buffer');
  assert.deepEqual(incremental.getNewEvents(), []);
});

test('out-of-order batch inputs normalize, while incremental inputs reject backward time', () => {
  const structure = bullishStructure();
  const chronologicalCandles = [candle(90, 109, 115, 108, 111), candle(105, 111, 112, 109, 110)];
  const normal = run(chronologicalCandles, structure.swings, {}, structure.snapshots);
  const reversed = run([...chronologicalCandles].reverse(), [...structure.swings].reverse(), {}, [...structure.snapshots].reverse());
  assert.equal(JSON.stringify(reversed), JSON.stringify(normal));

  const detector = createBreakOfStructureDetector();
  detector.pushConfirmedSwing(structure.swings[1]!);
  assert.throws(() => detector.pushConfirmedSwing(structure.swings[0]!), (error) => error instanceof BreakOfStructureDetectionError && error.code === 'OUT_OF_ORDER_INCREMENTAL_INPUT');
  const detector2 = createBreakOfStructureDetector();
  detector2.pushStructureSnapshot(structure.snapshots[1]!);
  assert.throws(() => detector2.pushStructureSnapshot(structure.snapshots[0]!), /must not move backward/);
  const detector3 = createBreakOfStructureDetector();
  detector3.pushCandle(candle(90, 100, 101, 99, 100));
  assert.throws(() => detector3.pushCandle(candle(75, 100, 101, 99, 100)), /unique, ascending/);
  assert.throws(() => detector3.pushConfirmedSwing(swing('late-arrival', 'HIGH', 100, 0, 30)), (error) => error instanceof BreakOfStructureDetectionError && error.code === 'LATE_INCREMENTAL_INFORMATION');
});

test('duplicate IDs and candles are rejected deterministically', () => {
  const high = swing('same', 'HIGH', 100, 0, 30);
  assert.throws(() => run([], [high, high], {}, []), (error) => error instanceof BreakOfStructureDetectionError && error.code === 'DUPLICATE_SWING_ID');
  const duplicate = candle(45, 99, 105, 98, 101);
  assert.throws(() => run([duplicate, duplicate], [high]), (error) => error instanceof BreakOfStructureDetectionError && error.code === 'DUPLICATE_CANDLE');
  const sourceSnapshots = snapshots([high]);
  assert.throws(() => run([], [high], {}, [sourceSnapshots[0]!, sourceSnapshots[0]!]), /duplicate structure snapshot/i);
});

test('invalid candle OHLC, timestamps, and non-positive prices are rejected', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  assert.throws(() => run([{ ...candle(45, 99, 105, 98, 101), high: 90 }], [high]), /Candle high\/low|positive and finite/);
  assert.throws(() => run([{ ...candle(45, 99, 105, 98, 101), openedAt: '' }], [high]), /valid completed interval|timestamps/);
  assert.throws(() => run([{ ...candle(45, 99, 105, 98, 101), close: 0 }], [high]), /positive and finite/);
  assert.throws(() => run([], [{ ...high, price: -1 }], {}, []), /positive.*finite/);
});

test('later structure information cannot rewrite an immutable historical BOS event', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  const historical = run([candle(45, 99, 105, 98, 101)], [high]);
  const futureLow = swing('future-low', 'LOW', 80, 60, 90);
  const expandedSwings = [high, futureLow];
  const expanded = run([candle(45, 99, 105, 98, 101)], expandedSwings, {}, snapshots(expandedSwings));
  assert.equal(expanded.events[0]!.fingerprint, historical.events[0]!.fingerprint);
  assert.deepEqual(expanded.events[0], historical.events[0]);
});

test('an outside close may break bullish and bearish levels in fixed direction order', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  const low = swing('low', 'LOW', 105, 15, 45);
  const sourceSnapshots = snapshots([high, low]);
  const result = run([candle(60, 102, 110, 95, 102)], [high, low], { swingEligibility: 'ALL_UNBROKEN_ACCEPTED' }, sourceSnapshots);
  assert.deepEqual(result.events.map((event) => event.direction), ['BULLISH', 'BEARISH']);
});

test('incremental reset clears events, rejections, warnings, and replay state', () => {
  const high = swing('high', 'HIGH', 100, 0, 30);
  const detector = createBreakOfStructureDetector();
  detector.pushConfirmedSwing(high);
  snapshots([high]).forEach((value) => detector.pushStructureSnapshot(value));
  detector.pushCandle(candle(45, 99, 105, 98, 101));
  assert.equal(detector.getAllEvents().length, 1);
  detector.reset();
  assert.deepEqual(detector.getAllEvents(), []);
  assert.deepEqual(detector.getRejectedCandidates(), []);
  assert.deepEqual(detector.getWarnings(), []);
});

test('confirmed-structure BOS module has no MSS, AI, strategy, backtesting, route, clock, or randomness dependency', () => {
  const source = readFileSync('lib/market-intelligence/structure/break-of-structure/break-of-structure-detector.ts', 'utf8');
  assert.doesNotMatch(source, /market structure shift|choch|openai|anthropic|prompt|strategy|backtesting|app\/api|Date\.now|Math\.random|randomUUID/i);
});

test('research audit upgrades only confirmed-structure BOS and remains blocked downstream', () => {
  const audit = readFileSync('research/strategies/xauusd-structure-pullback/1.0.0/detector-dependency-audit.md', 'utf8');
  assert.match(audit, /\| Break of structure \| SUPPORTED \| `confirmed-structure-bos@1\.0\.0`/);
  assert.match(audit, /\| Market structure shift \| SUPPORTED \| `market-structure-shift@1\.0\.0`/);
  assert.match(audit, /\| Fair value gap \| SUPPORTED \| `fair-value-gap-lifecycle@1\.0\.0`/);
  assert.match(audit, /\| Liquidity sweep \| SUPPORTED \| `structural-liquidity-sweep@1\.0\.0`/);
  assert.match(audit, /\| Structural stop placement \| UNSUPPORTED \|/);
  assert.match(audit, /\| Liquidity target detection \| UNSUPPORTED \|/);
  assert.match(audit, /Conclusion: `DETECTOR_IMPLEMENTATION_REQUIRED`/);
});
