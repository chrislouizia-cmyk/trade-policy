import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import type { ConfirmedSwing, SwingDirection } from '../lib/market-intelligence/detectors/confirmed-swing/confirmed-swing-types.ts';
import { createStructuralLiquiditySweepDetector, DEFAULT_STRUCTURAL_LIQUIDITY_SWEEP_CONFIG, detectStructuralLiquiditySweeps, serializeStructuralLiquiditySweepResult, StructuralLiquiditySweepError, type StructuralLiquiditySweepConfig } from '../lib/market-intelligence/liquidity/structural-sweep/index.ts';
import { detectBreaksOfStructure, type BreakOfStructureEvent } from '../lib/market-intelligence/structure/break-of-structure/index.ts';
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
const levels = () => [
  swing('h1', 'HIGH', 100, 0, 15), swing('l1', 'LOW', 90, 15, 30),
  swing('h2', 'HIGH', 110, 30, 45), swing('l2', 'LOW', 95, 45, 60),
];
const snapshots = (values: readonly ConfirmedSwing[], config = {}): readonly StructureSnapshot[] => reduceMarketStructure(values, config).snapshots;
const run = (candles: readonly NormalizedCandle[], values = levels(), config: Partial<StructuralLiquiditySweepConfig> = {}, sourceSnapshots = snapshots(values), bosEvents: readonly BreakOfStructureEvent[] = []) =>
  detectStructuralLiquiditySweeps({ candles, confirmedSwings: values, structureSnapshots: sourceSnapshots, bosEvents, config });

test('detects basic buy-side and sell-side structural sweeps at candle close', () => {
  const buy = run([candle(75, 109, 112, 108, 109)]).events[0]!;
  assert.deepEqual({ direction: buy.direction, source: buy.sourceSwingId, detectedAt: buy.detectedAt }, { direction: 'BUY_SIDE', source: 'h2', detectedAt: at(90) });
  assert.equal(buy.excursionDistance, 2);
  const sell = run([candle(75, 96, 97, 92, 96)]).events[0]!;
  assert.deepEqual({ direction: sell.direction, source: sell.sourceSwingId }, { direction: 'SELL_SIDE', source: 'l2' });
  assert.equal(sell.excursionDistance, 3);
});

test('wick without reclaim, equality touch, and strict close policy do not qualify', () => {
  assert.equal(run([candle(75, 109, 112, 108, 111)]).events.length, 0);
  assert.equal(run([candle(75, 96, 97, 92, 94)]).events.length, 0);
  assert.equal(run([candle(75, 109, 110, 108, 109)]).events.length, 0);
  assert.equal(run([candle(75, 109, 112, 108, 110)], levels(), { closePolicy: 'CLOSE_AT_OR_INSIDE' }).events.length, 1);
  assert.equal(run([candle(75, 109, 112, 108, 110)], levels(), { closePolicy: 'CLOSE_BACK_INSIDE' }).events.length, 0);
});

test('source swing and accepted snapshot must exist by sweep open', () => {
  const late = [...levels(), swing('late-high', 'HIGH', 120, 75, 90)];
  assert.equal(run([candle(75, 119, 122, 118, 119)], late, { sourceEligibility: 'LATEST_CONFIRMED' }, snapshots(late)).events.length, 0);
  const values = levels(), sourceSnapshots = snapshots(values);
  const futureOnly = [{ ...sourceSnapshots.at(-1)!, id: 'future', processedAt: at(90) }];
  assert.equal(run([candle(75, 109, 112, 108, 109)], values, {}, futureOnly).events.length, 0);
});

test('LATEST_CONFIRMED may use a non-accepted latest swing while structural policy does not', () => {
  const base = levels(), rejected = swing('rejected-high', 'HIGH', 115, 60, 75);
  const values = [...base, rejected], sourceSnapshots = snapshots(base);
  const event = candle(90, 114, 117, 113, 114);
  assert.equal(run([event], values, { sourceEligibility: 'LATEST_CONFIRMED' }, sourceSnapshots).events[0]!.sourceSwingId, 'rejected-high');
  assert.equal(run([event], values, { sourceEligibility: 'LATEST_ACCEPTED_STRUCTURE' }, sourceSnapshots).events.length, 0);
});

test('ALL_UNCONSUMED_ACCEPTED emits multiple swept levels in stable order', () => {
  const values = levels(), result = run([candle(75, 99, 115, 98, 99)], values, { sourceEligibility: 'ALL_UNCONSUMED_ACCEPTED' });
  assert.deepEqual(result.events.map((event) => event.sourceSwingId), ['h1', 'h2']);
  const reversed = detectStructuralLiquiditySweeps({ candles: [candle(75, 99, 115, 98, 99)], confirmedSwings: [...values].reverse(), structureSnapshots: [...snapshots(values)].reverse(), config: { sourceEligibility: 'ALL_UNCONSUMED_ACCEPTED' } });
  assert.equal(JSON.stringify(reversed), JSON.stringify(result));
});

test('BOS conflict policies are explicit and never recalculate BOS', () => {
  const values = levels(), sourceSnapshots = snapshots(values), eventCandle = candle(75, 109, 115, 108, 111);
  const bos = detectBreaksOfStructure({ candles: [eventCandle], confirmedSwings: values, structureSnapshots: sourceSnapshots }).events[0]!;
  const config = { reclaimToleranceAbsolute: 2, closePolicy: 'CLOSE_BEYOND_ALLOWED_IF_NO_BOS' as const };
  assert.equal(run([eventCandle], values, { ...config, bosConflictPolicy: 'BOS_WINS' }, sourceSnapshots, [bos]).rejectedCandidates[0]!.rejectionReason, 'CONFLICTING_ACCEPTED_BOS');
  const sweepWins = run([eventCandle], values, { ...config, bosConflictPolicy: 'SWEEP_WINS' }, sourceSnapshots, [bos]).events[0]!;
  assert.equal(sweepWins.conflictingBosEventId, bos.id);
  assert.equal(run([eventCandle], values, { ...config, bosConflictPolicy: 'REJECT_AMBIGUOUS' }, sourceSnapshots, [bos]).rejectedCandidates[0]!.rejectionReason, 'AMBIGUOUS_BOS_SWEEP_CONFLICT');
  assert.equal(run([eventCandle], values, { ...config, bosConflictPolicy: 'BOS_WINS' }, sourceSnapshots).rejectedCandidates[0]!.rejectionReason, 'CONFLICTING_ACCEPTED_BOS');
});

test('CONSUME_ONCE rejects repeats and a new accepted level has independent eligibility', () => {
  const first = candle(75, 109, 112, 108, 109), second = candle(90, 109, 113, 108, 109);
  const repeated = run([first, second]);
  assert.equal(repeated.events.length, 1);
  assert.equal(repeated.rejectedCandidates[0]!.rejectionReason, 'SOURCE_ALREADY_CONSUMED');
  const values = [...levels(), swing('new-high', 'HIGH', 112, 75, 90)];
  const sourceSnapshots = snapshots(values);
  const independent = run([first, candle(105, 111, 114, 110, 111)], values, {}, sourceSnapshots);
  assert.deepEqual(independent.events.map((event) => event.sourceSwingId), ['h2', 'new-high']);
});

test('repeat-after-reset requires an explicit completed close beyond the level', () => {
  const config = { consumptionPolicy: 'ALLOW_REPEAT_AFTER_RESET' as const, repeatResetPolicy: 'AFTER_CLOSE_BACK_BEYOND_LEVEL' as const };
  const result = run([
    candle(75, 109, 112, 108, 109),
    candle(90, 109, 111, 108, 111),
    candle(105, 109, 113, 108, 109),
  ], levels(), config);
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events.map((event) => event.sweepOpenedAt), [at(75), at(105)]);
  assert.equal(run([candle(75, 109, 112, 108, 109), candle(90, 109, 113, 108, 109)], levels(), { ...config, repeatResetPolicy: 'MANUAL_ONLY' }).events.length, 1);
});

test('gap policy accepts or rejects without inferring intrabar order', () => {
  const gap = candle(75, 111, 113, 108, 109);
  assert.equal(run([gap]).events[0]!.gapSweep, true);
  assert.equal(run([gap], levels(), { gapPolicy: 'REJECT' }).rejectedCandidates[0]!.rejectionReason, 'GAP_SWEEP_REJECTED');
});

test('dual sweep default rejects ambiguity while explicit policies serialize deterministically', () => {
  const outside = candle(75, 100, 112, 92, 100);
  const rejected = run([outside]);
  assert.equal(rejected.events.length, 0);
  assert.deepEqual(rejected.rejectedCandidates.map((event) => event.rejectionReason), ['AMBIGUOUS_DUAL_SWEEP', 'AMBIGUOUS_DUAL_SWEEP']);
  assert.deepEqual(run([outside], levels(), { sameCandleDualSweepPolicy: 'ALLOW_BOTH' }).events.map((event) => event.direction), ['BUY_SIDE', 'SELL_SIDE']);
  assert.deepEqual(run([outside], levels(), { sameCandleDualSweepPolicy: 'PROCESS_SELL_SIDE_THEN_BUY_SIDE' }).events.map((event) => event.direction), ['SELL_SIDE', 'BUY_SIDE']);
});

test('absolute, relative, and ATR excursion thresholds use inclusive equality', () => {
  const event = candle(75, 109, 112, 108, 109);
  assert.equal(run([event], levels(), { minimumExcursionAbsolute: 2 }).events.length, 1);
  assert.equal(run([event], levels(), { minimumExcursionAbsolute: 2.01 }).rejectedCandidates[0]!.rejectionReason, 'ABSOLUTE_EXCURSION_BELOW_MINIMUM');
  assert.equal(run([event], levels(), { minimumExcursionRelative: 2 / 110 }).events.length, 1);
  assert.equal(run([event], levels(), { minimumExcursionRelative: 2 / 110 + .0001 }).rejectedCandidates[0]!.rejectionReason, 'RELATIVE_EXCURSION_BELOW_MINIMUM');
  assert.equal(run([event], levels(), { minimumExcursionAtrMultiple: .1, atrPeriod: 2 }).rejectedCandidates[0]!.rejectionReason, 'INSUFFICIENT_ATR_HISTORY');
  const history = [candle(0, 100, 102, 98, 100), candle(15, 100, 102, 98, 100), candle(30, 100, 102, 98, 100), event];
  assert.equal(run(history, levels(), { minimumExcursionAtrMultiple: .5, atrPeriod: 2 }).events[0]!.excursionAtrMultiple, .5);
});

test('incomplete candles are ignored; malformed data and duplicate identities reject', () => {
  const incomplete = run([candle(75, 109, 112, 108, 109, false)]);
  assert.equal(incomplete.events.length, 0);
  assert.match(incomplete.warnings[0]!, /Ignored incomplete candle/);
  assert.throws(() => run([{ ...candle(75, 109, 112, 108, 109), high: 100 }]), /contain.*OHLC|geometry/i);
  const duplicate = candle(75, 109, 112, 108, 109);
  assert.throws(() => run([duplicate, duplicate]), (error) => error instanceof StructuralLiquiditySweepError && error.code === 'DUPLICATE_CANDLE');
  const values = levels();
  assert.throws(() => run([], [values[0]!, values[0]!], {}, []), /duplicate swing/i);
  const sourceSnapshots = snapshots(values);
  assert.throws(() => run([], values, {}, [sourceSnapshots[0]!, sourceSnapshots[0]!]), /duplicate snapshot/i);
});

test('batch and incremental APIs are byte-identical and reject time travel', () => {
  const values = levels(), sourceSnapshots = snapshots(values), event = candle(75, 109, 112, 108, 109);
  const batch = run([event], values, {}, sourceSnapshots);
  const incremental = createStructuralLiquiditySweepDetector();
  values.forEach((value) => incremental.pushConfirmedSwing(value));
  sourceSnapshots.forEach((value) => incremental.pushStructureSnapshot(value));
  incremental.pushCandle(event);
  assert.equal(JSON.stringify(incremental.getResult()), JSON.stringify(batch));
  assert.equal(incremental.getNewEvents().length, 1);
  assert.deepEqual(incremental.getNewEvents(), []);
  assert.throws(() => incremental.pushCandle(candle(60, 100, 101, 99, 100)), /ascending/);
  assert.throws(() => incremental.pushConfirmedSwing(swing('late', 'HIGH', 100, 0, 15)), /backward|processed history/);
  incremental.reset();
  assert.deepEqual(incremental.getAllEvents(), []);
  assert.deepEqual(incremental.getRejectedCandidates(), []);
});

test('future BOS and structure cannot rewrite a historical sweep', () => {
  const values = levels(), sourceSnapshots = snapshots(values), event = candle(75, 109, 112, 108, 109);
  const historical = run([event], values, {}, sourceSnapshots).events[0]!;
  const futureSwing = swing('future-high', 'HIGH', 120, 105, 120);
  const futureSnapshots = snapshots([...values, futureSwing]).filter((value) => value.processedAt === at(120));
  const futureBos = { ...detectBreaksOfStructure({ candles: [candle(135, 119, 125, 118, 121)], confirmedSwings: [...values, futureSwing], structureSnapshots: [...sourceSnapshots, ...futureSnapshots] }).events[0]!, id: 'future-bos' };
  const expanded = run([event], [...values, futureSwing], {}, [...sourceSnapshots, ...futureSnapshots], [futureBos]).events[0]!;
  assert.deepEqual(expanded, historical);
});

test('fingerprints, evidence, immutability, and serialization are deterministic', () => {
  const first = run([candle(75, 109, 112, 108, 109)]), second = run([structuredClone(candle(75, 109, 112, 108, 109))], structuredClone(levels()));
  assert.equal(first.events[0]!.id, second.events[0]!.id);
  assert.equal(serializeStructuralLiquiditySweepResult(first), serializeStructuralLiquiditySweepResult(second));
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.events[0]!.evidence));
  assert.match(first.events[0]!.evidence.at(-1)!, /does not confirm reversal/);
});

test('defaults are conservative and module remains isolated', () => {
  assert.equal(DEFAULT_STRUCTURAL_LIQUIDITY_SWEEP_CONFIG.sourceEligibility, 'LATEST_ACCEPTED_STRUCTURE');
  assert.equal(DEFAULT_STRUCTURAL_LIQUIDITY_SWEEP_CONFIG.bosConflictPolicy, 'BOS_WINS');
  assert.equal(DEFAULT_STRUCTURAL_LIQUIDITY_SWEEP_CONFIG.consumptionPolicy, 'CONSUME_ONCE');
  assert.equal(DEFAULT_STRUCTURAL_LIQUIDITY_SWEEP_CONFIG.sameCandleDualSweepPolicy, 'REJECT_AMBIGUOUS');
  const source = readFileSync('lib/market-intelligence/liquidity/structural-sweep/structural-liquidity-sweep-detector.ts', 'utf8');
  assert.doesNotMatch(source, new RegExp('openai|anthropic|prompt|backtesting|app/api|Date[.]now|Math[.]random|randomUUID', 'i'));
  assert.doesNotMatch(source, /detectConfirmedSwings|reduceMarketStructure|detectBreaksOfStructure|classifyMarketStructureTransitions/);
});

test('research audit upgrades only structural liquidity sweep support', () => {
  const audit = readFileSync('research/strategies/xauusd-structure-pullback/1.0.0/detector-dependency-audit.md', 'utf8');
  assert.match(audit, /\| Liquidity sweep \| SUPPORTED \| `structural-liquidity-sweep@1\.0\.0`/);
  assert.match(audit, /\| Fair value gap \| SUPPORTED \| `fair-value-gap-lifecycle@1\.0\.0`/);
  assert.match(audit, /\| Structural stop placement \| UNSUPPORTED \|/);
  assert.match(audit, /\| Liquidity target detection \| UNSUPPORTED \|/);
  assert.match(audit, /Conclusion: `DETECTOR_IMPLEMENTATION_REQUIRED`/);
});
