import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ConfirmedSwing, SwingDirection } from '../lib/market-intelligence/detectors/confirmed-swing/confirmed-swing-types.ts';
import { createStructureReducer, equalityTolerance, reduceMarketStructure, serializeStructureState, StructureReducerError, type StructureReducerConfig } from '../lib/market-intelligence/structure/index.ts';

const at = (minute: number): string => new Date(Date.UTC(2024, 0, 1, 0, minute)).toISOString();
const swing = (id: string, direction: SwingDirection, price: number, pivotIndex: number, confirmedIndex = pivotIndex + 2, patch: Partial<ConfirmedSwing> = {}): ConfirmedSwing => ({
  id,
  direction,
  pivotIndex,
  confirmedIndex,
  pivotAt: at(pivotIndex * 15),
  confirmedAt: at((confirmedIndex + 1) * 15),
  price,
  leftBars: 2,
  rightBars: 2,
  prominence: 1,
  prominenceAtrMultiple: null,
  strength: .1,
  equalPriceConflict: false,
  sourceCandle: { open: price - .5, high: direction === 'HIGH' ? price : price + 1, low: direction === 'LOW' ? price : price - 1, close: price + .25 },
  ...patch,
});
const labels = (swings: readonly ConfirmedSwing[], config: Partial<StructureReducerConfig> = {}): string[] => reduceMarketStructure(swings, config).classifiedSwings.map((item) => item.label);

test('first high and low receive INITIAL labels and insufficient structure is UNDEFINED', () => {
  const highOnly = reduceMarketStructure([swing('h1', 'HIGH', 100, 1)]);
  assert.deepEqual(labels([swing('h1', 'HIGH', 100, 1), swing('l1', 'LOW', 90, 4)]), ['INITIAL_HIGH', 'INITIAL_LOW']);
  assert.equal(highOnly.finalSnapshot.bias, 'UNDEFINED');
  assert.equal(highOnly.finalSnapshot.latestHighLabel, 'INITIAL_HIGH');
  assert.equal(reduceMarketStructure([]).finalSnapshot.bias, 'UNDEFINED');
});

test('higher, lower, and equal highs classify HH, LH, and EH', () => {
  assert.deepEqual(labels([swing('a', 'HIGH', 100, 1), swing('b', 'HIGH', 110, 4), swing('c', 'HIGH', 105, 7), swing('d', 'HIGH', 105, 10)]), ['INITIAL_HIGH', 'HH', 'LH', 'EH']);
});

test('higher, lower, and equal lows classify HL, LL, and EL', () => {
  assert.deepEqual(labels([swing('a', 'LOW', 100, 1), swing('b', 'LOW', 110, 4), swing('c', 'LOW', 90, 7), swing('d', 'LOW', 90, 10)]), ['INITIAL_LOW', 'HL', 'LL', 'EL']);
});

test('HH plus HL is BULLISH and LH plus LL is BEARISH', () => {
  const bullish = reduceMarketStructure([swing('h1', 'HIGH', 100, 1), swing('l1', 'LOW', 90, 4), swing('h2', 'HIGH', 110, 7), swing('l2', 'LOW', 95, 10)]);
  assert.equal(bullish.finalSnapshot.bias, 'BULLISH');
  const bearish = reduceMarketStructure([swing('h1', 'HIGH', 100, 1), swing('l1', 'LOW', 90, 4), swing('h2', 'HIGH', 95, 7), swing('l2', 'LOW', 85, 10)]);
  assert.equal(bearish.finalSnapshot.bias, 'BEARISH');
});

test('conflicting or equal comparable labels produce MIXED', () => {
  const conflict = reduceMarketStructure([swing('h1', 'HIGH', 100, 1), swing('l1', 'LOW', 90, 4), swing('h2', 'HIGH', 110, 7), swing('l2', 'LOW', 85, 10)]);
  assert.equal(conflict.finalSnapshot.bias, 'MIXED');
  const equal = reduceMarketStructure([swing('h1', 'HIGH', 100, 1), swing('l1', 'LOW', 90, 4), swing('h2', 'HIGH', 100, 7), swing('l2', 'LOW', 90, 10)]);
  assert.equal(equal.finalSnapshot.bias, 'MIXED');
});

test('confirmedAt, never pivotAt, controls chronological processing', () => {
  const latePivotEarlyConfirmation = swing('later-pivot', 'HIGH', 110, 10, 12);
  const earlyPivotLateConfirmation = swing('early-pivot', 'HIGH', 100, 1, 15);
  const result = reduceMarketStructure([earlyPivotLateConfirmation, latePivotEarlyConfirmation]);
  assert.deepEqual(result.classifiedSwings.map((item) => item.swing.id), ['later-pivot', 'early-pivot']);
  assert.deepEqual(result.classifiedSwings.map((item) => item.label), ['INITIAL_HIGH', 'LH']);
  assert.equal(result.snapshots[0]!.processedAt, latePivotEarlyConfirmation.confirmedAt);
});

test('batch normalizes out-of-order inputs without mutating them', () => {
  const chronological = [swing('a', 'HIGH', 100, 1), swing('b', 'LOW', 90, 4), swing('c', 'HIGH', 110, 7)];
  const reversed = [...chronological].reverse();
  const before = JSON.stringify(reversed);
  assert.equal(JSON.stringify(reduceMarketStructure(reversed)), JSON.stringify(reduceMarketStructure(chronological)));
  assert.equal(JSON.stringify(reversed), before);
});

test('incremental input rejects backward confirmedAt and duplicate IDs', () => {
  const reducer = createStructureReducer();
  reducer.pushSwing(swing('later', 'HIGH', 100, 4));
  assert.throws(() => reducer.pushSwing(swing('earlier', 'LOW', 90, 1)), (error) => error instanceof StructureReducerError && error.code === 'OUT_OF_ORDER_INCREMENTAL_SWING');
  assert.throws(() => reducer.pushSwing(swing('later', 'HIGH', 101, 5)), (error) => error instanceof StructureReducerError && error.code === 'DUPLICATE_SWING_ID');
  assert.throws(() => reduceMarketStructure([swing('same', 'HIGH', 100, 1), swing('same', 'LOW', 90, 4)]), /Duplicate swing ID/);
});

test('duplicate logical swings with different IDs are rejected and warned', () => {
  const original = swing('a', 'HIGH', 100, 1);
  const duplicate = swing('b', 'HIGH', 100, 1, 3, { pivotAt: original.pivotAt });
  const result = reduceMarketStructure([original, duplicate]);
  assert.deepEqual(result.classifiedSwings.map((item) => item.accepted), [true, false]);
  assert.equal(result.classifiedSwings[1]!.rejectionReason, 'DUPLICATE_LOGICAL_SWING');
  assert.match(result.warnings[0]!, /Duplicate logical HIGH pivot/);
});

test('batch and chronological incremental results are byte-identical', () => {
  const input = [swing('h1', 'HIGH', 100, 1), swing('l1', 'LOW', 90, 4), swing('h2', 'HIGH', 110, 7), swing('l2', 'LOW', 95, 10)];
  const batch = reduceMarketStructure(input);
  const incremental = createStructureReducer();
  input.forEach((item) => incremental.pushSwing(item));
  assert.equal(JSON.stringify(incremental.getResult()), JSON.stringify(batch));
  assert.equal(JSON.stringify(incremental.getAllClassifiedSwings()), JSON.stringify(batch.classifiedSwings));
  assert.equal(JSON.stringify(incremental.getSnapshots()), JSON.stringify(batch.snapshots));
});

test('new-classification reads are repeat-safe and reset clears all state', () => {
  const reducer = createStructureReducer();
  reducer.pushSwing(swing('h1', 'HIGH', 100, 1));
  assert.equal(reducer.getNewClassifications().length, 1);
  assert.deepEqual(reducer.getNewClassifications(), []);
  reducer.reset();
  assert.deepEqual(reducer.getAllClassifiedSwings(), []);
  assert.deepEqual(reducer.getSnapshots(), []);
  assert.equal(reducer.getCurrentSnapshot().processedAt, null);
});

test('absolute and relative equality tolerances use the frozen maximum formula', () => {
  const absolute = reduceMarketStructure([swing('a', 'HIGH', 100, 1), swing('b', 'HIGH', 100.5, 4)], { equalityToleranceAbsolute: 1 });
  assert.equal(absolute.classifiedSwings[1]!.label, 'EH');
  const relative = reduceMarketStructure([swing('a', 'LOW', 1_000, 1), swing('b', 'LOW', 1_000.5, 4)], { equalityToleranceRelative: .001 });
  assert.equal(relative.classifiedSwings[1]!.label, 'EL');
  assert.equal(equalityTolerance(100, 101, absolute.configuration), 1);
  assert.equal(equalityTolerance(1_000, 1_000.5, relative.configuration), 1.0005);
});

test('KEEP_ALL transparently classifies consecutive highs and lows', () => {
  assert.deepEqual(labels([swing('h1', 'HIGH', 100, 1), swing('h2', 'HIGH', 110, 4), swing('h3', 'HIGH', 105, 7)]), ['INITIAL_HIGH', 'HH', 'LH']);
  assert.deepEqual(labels([swing('l1', 'LOW', 100, 1), swing('l2', 'LOW', 90, 4), swing('l3', 'LOW', 95, 7)]), ['INITIAL_LOW', 'LL', 'HL']);
});

test('KEEP_FIRST rejects later same-direction swings until an opposite swing', () => {
  const result = reduceMarketStructure([
    swing('h1', 'HIGH', 100, 1),
    swing('h2', 'HIGH', 110, 4),
    swing('l1', 'LOW', 90, 7),
    swing('h3', 'HIGH', 120, 10),
  ], { sameDirectionReplacementPolicy: 'KEEP_FIRST' });
  assert.deepEqual(result.classifiedSwings.map((item) => item.accepted), [true, false, true, true]);
  assert.equal(result.classifiedSwings[1]!.rejectionReason, 'CONSECUTIVE_SAME_DIRECTION_KEEP_FIRST');
  assert.equal(result.classifiedSwings[3]!.label, 'HH');
});

test('KEEP_EXTREME rejects weaker same-direction swings and records replacements', () => {
  const result = reduceMarketStructure([
    swing('h1', 'HIGH', 100, 1),
    swing('h2', 'HIGH', 90, 4),
    swing('h3', 'HIGH', 110, 7),
  ], { sameDirectionReplacementPolicy: 'KEEP_EXTREME' });
  assert.deepEqual(result.classifiedSwings.map((item) => item.accepted), [true, false, true]);
  assert.equal(result.classifiedSwings[1]!.rejectionReason, 'CONSECUTIVE_SAME_DIRECTION_NOT_MORE_EXTREME');
  assert.equal(result.classifiedSwings[2]!.replacementOfSwingId, 'h1');
});

test('minimum swing separation rejects close comparable pivots explicitly', () => {
  const result = reduceMarketStructure([swing('h1', 'HIGH', 100, 3), swing('h2', 'HIGH', 110, 4)], { minimumSwingSeparationBars: 2 });
  assert.equal(result.classifiedSwings[1]!.accepted, false);
  assert.equal(result.classifiedSwings[1]!.rejectionReason, 'MINIMUM_SWING_SEPARATION_2_BARS');
});

function outsidePair(): [ConfirmedSwing, ConfirmedSwing] {
  const high = swing('outside-high', 'HIGH', 110, 5, 7);
  const low = swing('outside-low', 'LOW', 80, 5, 7, { pivotAt: high.pivotAt, confirmedAt: high.confirmedAt });
  return [high, low];
}

test('outside candle HIGH-then-LOW and LOW-then-HIGH policies are deterministic', () => {
  const [high, low] = outsidePair();
  const highFirst = reduceMarketStructure([low, high], { outsideCandlePolicy: 'PROCESS_HIGH_THEN_LOW' });
  assert.deepEqual(highFirst.classifiedSwings.map((item) => item.swing.direction), ['HIGH', 'LOW']);
  const lowFirst = reduceMarketStructure([high, low], { outsideCandlePolicy: 'PROCESS_LOW_THEN_HIGH' });
  assert.deepEqual(lowFirst.classifiedSwings.map((item) => item.swing.direction), ['LOW', 'HIGH']);
  const incremental = createStructureReducer({ outsideCandlePolicy: 'PROCESS_HIGH_THEN_LOW' });
  incremental.pushSwing(high);
  incremental.pushSwing(low);
  assert.equal(JSON.stringify(incremental.getResult()), JSON.stringify(highFirst));
});

test('REJECT_AMBIGUOUS records both outside-candle observations without snapshots', () => {
  const result = reduceMarketStructure(outsidePair(), { outsideCandlePolicy: 'REJECT_AMBIGUOUS' });
  assert.deepEqual(result.classifiedSwings.map((item) => item.accepted), [false, false]);
  assert.ok(result.classifiedSwings.every((item) => item.rejectionReason === 'AMBIGUOUS_OUTSIDE_CANDLE_REJECTED'));
  assert.deepEqual(result.snapshots, []);
  assert.equal(result.finalSnapshot.bias, 'UNDEFINED');
});

test('invalid timestamps, chronology, prices, directions, and indices are rejected', () => {
  const valid = swing('valid', 'HIGH', 100, 1);
  assert.throws(() => reduceMarketStructure([{ ...valid, confirmedAt: '' }]), /valid timestamps/);
  assert.throws(() => reduceMarketStructure([{ ...valid, confirmedAt: at(1), pivotAt: at(2) }]), /cannot be earlier/);
  assert.throws(() => reduceMarketStructure([{ ...valid, price: -1 }]), /positive finite/);
  assert.throws(() => reduceMarketStructure([{ ...valid, direction: 'SIDEWAYS' as SwingDirection }]), /Unknown swing direction/);
  assert.throws(() => reduceMarketStructure([{ ...valid, confirmedIndex: 0 }]), /indices must be chronological/);
});

test('snapshots, evidence, IDs, serialization, and immutability are deterministic', () => {
  const input = [swing('h1', 'HIGH', 100, 1), swing('l1', 'LOW', 90, 4), swing('h2', 'HIGH', 110, 7), swing('l2', 'LOW', 95, 10)];
  const first = reduceMarketStructure(input);
  const second = reduceMarketStructure(structuredClone(input));
  assert.equal(first.reducerVersion, '1.0.0');
  assert.equal(serializeStructureState(first), serializeStructureState(second));
  assert.deepEqual(first.snapshots.map((item) => item.id), second.snapshots.map((item) => item.id));
  assert.equal(first.finalSnapshot.evidence.at(-1), 'Bias BULLISH because latest comparable structure is HH + HL.');
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.finalSnapshot) && Object.isFrozen(first.classifiedSwings[0]!.swing));
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
});

test('structure reducer has no AI, production route, backtesting, clock, or randomness dependency', () => {
  const source = readFileSync('lib/market-intelligence/structure/structure-reducer.ts', 'utf8');
  assert.doesNotMatch(source, /openai|anthropic|prompt|app\/api|backtesting|Date\.now|Math\.random|randomUUID/i);
});

test('research audit adds structure state only and leaves downstream capabilities blocked', () => {
  const audit = readFileSync('research/strategies/xauusd-structure-pullback/1.0.0/detector-dependency-audit.md', 'utf8');
  assert.match(audit, /\| Chronological structure state \| SUPPORTED \| `market-structure-reducer@1\.0\.0`/);
  assert.match(audit, /\| Break of structure \| (?:PARTIALLY_)?SUPPORTED \|/);
  assert.match(audit, /\| Market structure shift \| UNSUPPORTED \|/);
  assert.match(audit, /\| Fair value gap \| PARTIALLY_SUPPORTED \|/);
  assert.match(audit, /\| Liquidity sweep \| PARTIALLY_SUPPORTED \|/);
  assert.match(audit, /\| Structural stop placement \| UNSUPPORTED \|/);
  assert.match(audit, /\| Liquidity target detection \| UNSUPPORTED \|/);
  assert.match(audit, /Conclusion: `DETECTOR_IMPLEMENTATION_REQUIRED`/);
});
