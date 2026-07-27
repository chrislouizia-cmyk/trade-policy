import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import type { ConfirmedSwing, SwingDirection } from '../lib/market-intelligence/detectors/confirmed-swing/confirmed-swing-types.ts';
import { detectBreaksOfStructure, type BreakOfStructureEvent } from '../lib/market-intelligence/structure/break-of-structure/index.ts';
import { classifyMarketStructureTransitions, createMarketStructureShiftClassifier, DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG, MarketStructureShiftError, serializeMarketStructureShiftResult } from '../lib/market-intelligence/structure/market-structure-shift/index.ts';
import { reduceMarketStructure, type StructureSnapshot } from '../lib/market-intelligence/structure/index.ts';

const at = (minute: number): string => new Date(Date.UTC(2024, 0, 1, 0, minute)).toISOString();
const swing = (id: string, direction: SwingDirection, price: number, pivotMinute: number, confirmedMinute: number): ConfirmedSwing => ({
  id, direction, pivotIndex: pivotMinute / 15, confirmedIndex: confirmedMinute / 15, pivotAt: at(pivotMinute), confirmedAt: at(confirmedMinute), price,
  leftBars: 2, rightBars: 2, prominence: 2, prominenceAtrMultiple: null, strength: .2, equalPriceConflict: false,
  sourceCandle: { open: price, high: direction === 'HIGH' ? price : price + 1, low: direction === 'LOW' ? price : price - 1, close: price },
});
const candle = (minute: number, open: number, high: number, low: number, close: number): NormalizedCandle => ({
  openedAt: at(minute), closedAt: at(minute + 15), open, high, low, close, volume: 100, complete: true,
});
const bullishSwings = () => [
  swing('h1', 'HIGH', 100, 0, 15), swing('l1', 'LOW', 90, 15, 30),
  swing('h2', 'HIGH', 110, 30, 45), swing('protected-hl', 'LOW', 95, 45, 60),
];
const bearishSwings = () => [
  swing('h1', 'HIGH', 110, 0, 15), swing('l1', 'LOW', 100, 15, 30),
  swing('protected-lh', 'HIGH', 105, 30, 45), swing('l2', 'LOW', 90, 45, 60),
];
const structure = (swings: readonly ConfirmedSwing[]) => reduceMarketStructure(swings).snapshots;
const bos = (swings: readonly ConfirmedSwing[], snapshots: readonly StructureSnapshot[], eventCandle: NormalizedCandle): BreakOfStructureEvent =>
  detectBreaksOfStructure({ candles: [eventCandle], confirmedSwings: swings, structureSnapshots: snapshots }).events[0]!;
const classify = (event: BreakOfStructureEvent, swings: readonly ConfirmedSwing[], snapshots = structure(swings), config = {}, candles: readonly NormalizedCandle[] = []) =>
  classifyMarketStructureTransitions({ bosEvents: [event], confirmedSwings: swings, structureSnapshots: snapshots, candles, config });

test('aligned bullish and bearish BOS classify as continuation breaks', () => {
  const bulls = bullishSwings(), bullSnapshots = structure(bulls);
  const bull = classify(bos(bulls, bullSnapshots, candle(75, 109, 113, 108, 111)), bulls, bullSnapshots);
  assert.equal(bull.events[0]!.classification, 'CONTINUATION_BREAK');
  const bears = bearishSwings(), bearSnapshots = structure(bears);
  const bear = classify(bos(bears, bearSnapshots, candle(75, 91, 92, 85, 89)), bears, bearSnapshots);
  assert.equal(bear.events[0]!.classification, 'CONTINUATION_BREAK');
});

test('first protected counter-structure break is CHOCH in either direction', () => {
  const bulls = bullishSwings(), bullSnapshots = structure(bulls);
  const bearishShift = classify(bos(bulls, bullSnapshots, candle(75, 96, 97, 89, 94)), bulls, bullSnapshots).events[0]!;
  assert.equal(bearishShift.classification, 'CHOCH');
  assert.equal(bearishShift.protectedSwingId, 'protected-hl');
  assert.match(bearishShift.evidence.at(-1)!, /transition risk, not confirmed bearish trend/);
  const bears = bearishSwings(), bearSnapshots = structure(bears);
  const bullishShift = classify(bos(bears, bearSnapshots, candle(75, 104, 111, 103, 106)), bears, bearSnapshots).events[0]!;
  assert.equal(bullishShift.classification, 'CHOCH');
  assert.equal(bullishShift.protectedSwingId, 'protected-lh');
});

test('MIXED, UNDEFINED, missing snapshot, and missing protected swing fail conservatively', () => {
  const initial = [swing('h1', 'HIGH', 100, 0, 15), swing('l1', 'LOW', 90, 15, 30)];
  const initialSnapshots = structure(initial);
  const undefinedBos = bos(initial, initialSnapshots, candle(45, 99, 103, 98, 101));
  assert.equal(classify(undefinedBos, initial, initialSnapshots).rejectedCandidates[0]!.rejectionReason, 'PRIOR_BIAS_UNDEFINED');

  const mixed = [...initial, swing('h2', 'HIGH', 95, 30, 45), swing('l2', 'LOW', 95, 45, 60)];
  const mixedSnapshots = structure(mixed);
  const mixedBos = bos(mixed, mixedSnapshots, candle(75, 94, 99, 93, 96));
  assert.equal(classify(mixedBos, mixed, mixedSnapshots).rejectedCandidates[0]!.rejectionReason, 'PRIOR_BIAS_MIXED');

  assert.equal(classifyMarketStructureTransitions({ bosEvents: [undefinedBos], confirmedSwings: initial, structureSnapshots: [] }).rejectedCandidates[0]!.rejectionReason, 'PRIOR_SNAPSHOT_UNAVAILABLE');
  const invalidProtected = structuredClone(bullishSwings());
  const snapshots = structure(invalidProtected).map((value) => value.bias === 'BULLISH' ? { ...value, lastConfirmedLow: value.lastConfirmedLow ? { ...value.lastConfirmedLow, label: 'EL' as const } : null } : value);
  const counter = { ...bos(invalidProtected, structure(invalidProtected), candle(75, 96, 97, 90, 94)), sourceSnapshotId: snapshots.at(-1)!.id };
  assert.equal(classify(counter, invalidProtected, snapshots).rejectedCandidates[0]!.rejectionReason, 'PROTECTED_SWING_UNAVAILABLE');
});

test('a counter BOS against a non-protected swing is rejected', () => {
  const swings = [...bullishSwings(), swing('older-low', 'LOW', 92, 5, 20)];
  const snapshots = structure(bullishSwings());
  const source = bos(bullishSwings(), snapshots, candle(75, 96, 97, 89, 94));
  const altered = { ...source, id: 'bos:non-protected', sourceSwingId: 'older-low' };
  assert.equal(classify(altered, swings, snapshots).rejectedCandidates[0]!.rejectionReason, 'BOS_DID_NOT_BREAK_PROTECTED_SWING');
});

test('MSS_ONLY never emits CHOCH; CHOCH_FIRST_THEN_MSS advances deterministically', () => {
  const swings = bullishSwings(), snapshots = structure(swings);
  const first = bos(swings, snapshots, candle(75, 96, 97, 89, 94));
  assert.equal(classify(first, swings, snapshots, { terminologyMode: 'MSS_ONLY' }).events[0]!.classification, 'MARKET_STRUCTURE_SHIFT');
  const secondBase = { ...first, id: 'bos:second', fingerprint: 'second', sourceSwingId: 'protected-hl-2', detectedAt: at(105), breakoutOpenedAt: at(90) };
  const extraSwing = swing('protected-hl-2', 'LOW', 96, 60, 75);
  const extraClassified = { ...snapshots.at(-1)!.lastConfirmedLow!, id: 'classified:hl2', swing: extraSwing };
  const extraSnapshot = { ...snapshots.at(-1)!, id: 'snapshot:bull2', processedAt: at(75), lastConfirmedLow: extraClassified, sourceSwingIds: [...snapshots.at(-1)!.sourceSwingIds, extraSwing.id] };
  const second = { ...secondBase, sourceSnapshotId: extraSnapshot.id };
  const result = classifyMarketStructureTransitions({ bosEvents: [first, second], confirmedSwings: [...swings, extraSwing], structureSnapshots: [...snapshots, extraSnapshot] });
  assert.deepEqual(result.events.map((value) => value.classification), ['CHOCH', 'MARKET_STRUCTURE_SHIFT']);
  assert.equal(result.events[0]!.transitionRegimeId, result.events[1]!.transitionRegimeId);
});

test('one-shift policy rejects a duplicate protected level while ALLOW_MULTIPLE accepts it as MSS', () => {
  const swings = bullishSwings(), snapshots = structure(swings);
  const first = bos(swings, snapshots, candle(75, 96, 97, 89, 94));
  const second = { ...first, id: 'bos:second', fingerprint: 'second', detectedAt: at(105), breakoutOpenedAt: at(90) };
  const once = classifyMarketStructureTransitions({ bosEvents: [first, second], confirmedSwings: swings, structureSnapshots: snapshots });
  assert.equal(once.rejectedCandidates[0]!.rejectionReason, 'DUPLICATE_PROTECTED_SWING_SHIFT');
  const multiple = classifyMarketStructureTransitions({ bosEvents: [first, second], confirmedSwings: swings, structureSnapshots: snapshots, config: { duplicatePolicy: 'ALLOW_MULTIPLE' } });
  assert.deepEqual(multiple.events.map((value) => value.classification), ['CHOCH', 'MARKET_STRUCTURE_SHIFT']);
});

test('snapshot and protected swing must be known before breakout and future data cannot rewrite history', () => {
  const swings = bullishSwings(), snapshots = structure(swings);
  const source = bos(swings, snapshots, candle(75, 96, 97, 89, 94));
  const futureSnapshot = { ...snapshots.at(-1)!, id: 'future', processedAt: at(90) };
  const invalid = { ...source, id: 'bos:future-snapshot', sourceSnapshotId: 'future' };
  assert.equal(classify(invalid, swings, [...snapshots, futureSnapshot]).rejectedCandidates[0]!.rejectionReason, 'PRIOR_SNAPSHOT_NOT_AVAILABLE_BEFORE_BREAKOUT');
  const historical = classify(source, swings, snapshots).events[0]!;
  const futureSwing = swing('future', 'HIGH', 120, 105, 120);
  const expanded = classify(source, [...swings, futureSwing], [...snapshots, ...structure([...swings, futureSwing]).filter((value) => value.processedAt === at(120))]).events[0]!;
  assert.deepEqual(expanded, historical);
  assert.equal(historical.detectedAt, source.detectedAt);
});

test('minimum prior snapshots and displacement thresholds are strict and replay-safe', () => {
  const swings = bullishSwings(), snapshots = structure(swings), source = bos(swings, snapshots, candle(75, 96, 97, 89, 94));
  assert.equal(classify(source, swings, snapshots, { minimumPriorDirectionalSnapshots: 2 }).rejectedCandidates[0]!.rejectionReason, 'INSUFFICIENT_PRIOR_DIRECTIONAL_SNAPSHOTS');
  assert.equal(classify(source, swings, snapshots, { requireDisplacement: true, minimumBreakDistanceAbsolute: source.breakDistance + .01 }, []).rejectedCandidates[0]!.rejectionReason, 'INSUFFICIENT_ATR_HISTORY');
  const atrCandles = Array.from({ length: 4 }, (_, index) => candle(index * 15, 100, 102, 98, 100));
  const equality = classify(source, swings, snapshots, { requireDisplacement: true, atrPeriod: 2, minimumBreakDistanceAbsolute: source.breakDistance, minimumBreakDistanceRelative: source.breakDistanceRelative, minimumBreakDistanceAtrMultiple: source.breakDistance / 4 }, atrCandles);
  assert.equal(equality.events[0]!.classification, 'CHOCH');
  assert.equal(equality.events[0]!.breakDistanceAtrMultiple, source.breakDistance / 4);
  const below = classify(source, swings, snapshots, { requireDisplacement: true, atrPeriod: 2, minimumBreakDistanceRelative: source.breakDistanceRelative + .0001 }, atrCandles);
  assert.equal(below.rejectedCandidates[0]!.rejectionReason, 'RELATIVE_BREAK_DISTANCE_BELOW_MINIMUM');
});

test('batch normalizes input and incremental output is byte-identical', () => {
  const swings = bullishSwings(), snapshots = structure(swings), source = bos(swings, snapshots, candle(75, 96, 97, 89, 94));
  const batch = classifyMarketStructureTransitions({ bosEvents: [source], confirmedSwings: [...swings].reverse(), structureSnapshots: [...snapshots].reverse() });
  const incremental = createMarketStructureShiftClassifier();
  swings.forEach((value) => incremental.pushConfirmedSwing(value));
  snapshots.forEach((value) => incremental.pushStructureSnapshot(value));
  incremental.pushBosEvent(source);
  assert.equal(JSON.stringify(incremental.getResult()), JSON.stringify(batch));
  assert.equal(incremental.getNewEvents().length, 1);
  assert.deepEqual(incremental.getNewEvents(), []);
});

test('incremental rejects duplicates, backward input, and retroactive information; reset clears state', () => {
  const swings = bullishSwings(), snapshots = structure(swings), source = bos(swings, snapshots, candle(75, 96, 97, 89, 94));
  assert.throws(() => classifyMarketStructureTransitions({ bosEvents: [source, source], confirmedSwings: swings, structureSnapshots: snapshots }), (error) => error instanceof MarketStructureShiftError && error.code === 'DUPLICATE_BOS_ID');
  const incremental = createMarketStructureShiftClassifier();
  swings.forEach((value) => incremental.pushConfirmedSwing(value));
  snapshots.forEach((value) => incremental.pushStructureSnapshot(value));
  incremental.pushBosEvent(source);
  assert.throws(() => incremental.pushBosEvent({ ...source, id: 'older', detectedAt: at(80) }), /must not move backward/);
  assert.throws(() => incremental.pushConfirmedSwing(swing('late', 'HIGH', 100, 0, 30)), /must not move backward|already classified history/);
  incremental.reset();
  assert.deepEqual(incremental.getAllEvents(), []);
  assert.deepEqual(incremental.getRejectedCandidates(), []);
  assert.deepEqual(incremental.getWarnings(), []);
});

test('IDs, regime hashes, evidence, immutability, and serialization are stable', () => {
  const swings = bullishSwings(), snapshots = structure(swings), source = bos(swings, snapshots, candle(75, 96, 97, 89, 94));
  const first = classify(source, swings, snapshots), second = classify(structuredClone(source), structuredClone(swings), structuredClone(snapshots));
  assert.equal(first.events[0]!.id, second.events[0]!.id);
  assert.equal(first.events[0]!.transitionRegimeId, second.events[0]!.transitionRegimeId);
  assert.equal(serializeMarketStructureShiftResult(first), serializeMarketStructureShiftResult(second));
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.events[0]!.evidence));
});

test('defaults and module boundaries document conservative isolation', () => {
  assert.deepEqual(DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG, {
    terminologyMode: 'CHOCH_FIRST_THEN_MSS', requireEstablishedBias: true, minimumPriorDirectionalSnapshots: 1,
    requireBreakOfProtectedSwing: true, protectedSwingPolicy: 'LAST_HL_FOR_BULLISH_LAST_LH_FOR_BEARISH',
    requireDisplacement: false, minimumBreakDistanceAbsolute: 0, minimumBreakDistanceRelative: 0,
    minimumBreakDistanceAtrMultiple: 0, atrPeriod: 14, duplicatePolicy: 'ONE_SHIFT_PER_PRIOR_BIAS_REGIME',
    transitionResetPolicy: 'AFTER_NEW_DIRECTIONAL_STRUCTURE',
  });
  const source = readFileSync('lib/market-intelligence/structure/market-structure-shift/market-structure-shift-classifier.ts', 'utf8');
  assert.doesNotMatch(source, new RegExp('openai|anthropic|prompt|backtesting|app/api|Date[.]now|Math[.]random|randomUUID', 'i'));
  assert.doesNotMatch(source, /detectBreaksOfStructure|reduceMarketStructure|detectConfirmedSwings/);
});

test('research audit upgrades MSS and CHOCH only while strategy remains blocked downstream', () => {
  const audit = readFileSync('research/strategies/xauusd-structure-pullback/1.0.0/detector-dependency-audit.md', 'utf8');
  assert.match(audit, /\| Market structure shift \| SUPPORTED \| `market-structure-shift@1\.0\.0`/);
  assert.match(audit, /\| Change of character \| SUPPORTED \| `market-structure-shift@1\.0\.0`/);
  assert.match(audit, /\| Fair value gap \| PARTIALLY_SUPPORTED \|/);
  assert.match(audit, /\| Liquidity sweep \| SUPPORTED \| `structural-liquidity-sweep@1\.0\.0`/);
  assert.match(audit, /\| Structural stop placement \| UNSUPPORTED \|/);
  assert.match(audit, /\| Liquidity target detection \| UNSUPPORTED \|/);
  assert.match(audit, /Conclusion: `DETECTOR_IMPLEMENTATION_REQUIRED`/);
});
