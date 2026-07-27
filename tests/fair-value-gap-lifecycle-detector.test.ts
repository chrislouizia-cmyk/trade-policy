import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { createFairValueGapLifecycleDetector, DEFAULT_FAIR_VALUE_GAP_CONFIG, detectFairValueGapLifecycles, FairValueGapLifecycleError, serializeFairValueGapDetectionResult, type FairValueGapConfig } from '../lib/market-intelligence/imbalance/fair-value-gap/index.ts';

const base = Date.parse('2024-01-01T00:00:00.000Z');
const candle = (index: number, open: number, high: number, low: number, close: number, complete = true): NormalizedCandle => ({
  openedAt: new Date(base + index * 60_000).toISOString(), closedAt: new Date(base + (index + 1) * 60_000).toISOString(),
  open, high, low, close, volume: 100, complete,
});
const bullish = (): NormalizedCandle[] => [candle(0, 95, 100, 90, 95), candle(1, 102, 108, 98, 106), candle(2, 110, 115, 110, 112)];
const bearish = (): NormalizedCandle[] => [candle(0, 105, 110, 100, 105), candle(1, 98, 102, 95, 96), candle(2, 90, 90, 85, 88)];
const run = (candles: readonly NormalizedCandle[], config: Partial<FairValueGapConfig> = {}) => detectFairValueGapLifecycles({ candles, config });

test('creates exact bullish and bearish wick-to-wick gaps only at C3 close', () => {
  const bull = run(bullish()), bear = run(bearish());
  assert.deepEqual({ direction: bull.gaps[0]!.direction, lower: bull.gaps[0]!.lowerBound, upper: bull.gaps[0]!.upperBound, midpoint: bull.gaps[0]!.midpoint, size: bull.gaps[0]!.gapSize }, { direction: 'BULLISH', lower: 100, upper: 110, midpoint: 105, size: 10 });
  assert.deepEqual({ direction: bear.gaps[0]!.direction, lower: bear.gaps[0]!.lowerBound, upper: bear.gaps[0]!.upperBound }, { direction: 'BEARISH', lower: 90, upper: 100 });
  assert.equal(bull.gaps[0]!.detectedAt, bullish()[2]!.closedAt);
  assert.equal(run(bullish().slice(0, 2)).gaps.length, 0);
  assert.equal(run([{ ...bullish()[0]!, complete: false }, ...bullish().slice(1)]).gaps.length, 0);
});

test('equality and tolerance boundaries remain strict', () => {
  const equalBull = [candle(0, 95, 100, 90, 95), candle(1, 100, 105, 95, 100), candle(2, 100, 105, 100, 102)];
  assert.equal(run(equalBull).gaps.length, 0);
  const gap = [equalBull[0]!, equalBull[1]!, candle(2, 102, 106, 101, 103)];
  assert.equal(run(gap, { absoluteTolerance: 1 }).gaps.length, 0);
  assert.equal(run([gap[0]!, gap[1]!, { ...gap[2]!, low: 101.01 }], { absoluteTolerance: 1 }).gaps.length, 1);
  assert.equal(run(gap, { relativeTolerance: .01 }).gaps.length, 0);
});

test('minimum absolute, relative, and ATR thresholds are deterministic and inclusive', () => {
  assert.equal(run(bullish(), { minimumGapAbsolute: 10 }).gaps.length, 1);
  assert.equal(run(bullish(), { minimumGapAbsolute: 10.01 }).rejectedCandidates[0]!.rejectionReason, 'ABSOLUTE_GAP_BELOW_MINIMUM');
  assert.equal(run(bullish(), { minimumGapRelative: .1 }).gaps.length, 1);
  assert.equal(run(bullish(), { minimumGapRelative: .1001 }).rejectedCandidates[0]!.rejectionReason, 'RELATIVE_GAP_BELOW_MINIMUM');
  assert.equal(run(bullish(), { minimumGapAtrMultiple: .1, atrPeriod: 3 }).rejectedCandidates[0]!.rejectionReason, 'INSUFFICIENT_ATR_HISTORY');
  const history = [candle(0, 90, 100, 80, 90), candle(1, 90, 100, 80, 90), ...bullish().map((value, index) => ({ ...value, openedAt: candle(index + 2, 1, 1, 1, 1).openedAt, closedAt: candle(index + 2, 1, 1, 1, 1).closedAt }))];
  const result = run(history, { minimumGapAtrMultiple: .5, atrPeriod: 2 });
  assert.ok(result.gaps.some((gap) => gap.gapSizeAtrMultiple !== null));
});

test('first touch is emitted once and creation candle is excluded by default', () => {
  const result = run([...bullish(), candle(3, 112, 116, 109, 113), candle(4, 113, 116, 108, 114)]);
  const gap = result.gaps.find((value) => value.candle3Index === 2)!;
  assert.equal(gap.firstTouchedAt, candle(3, 112, 116, 109, 113).closedAt);
  assert.equal(result.lifecycleEvents.filter((event) => event.fvgId === gap.id && event.eventType === 'FIRST_TOUCH').length, 1);
  assert.equal(run(bullish()).lifecycleEvents.some((event) => event.eventType === 'FIRST_TOUCH'), false);
  const same = run(bullish(), { sameCandleLifecyclePolicy: 'ALLOW_CREATION_AND_TOUCH' });
  assert.equal(same.lifecycleEvents.some((event) => event.eventType === 'FIRST_TOUCH'), true);
});

test('bullish and bearish partial fill formulas are exact and maximum never decreases', () => {
  const bull = run([...bullish(), candle(3, 112, 116, 105, 112), candle(4, 112, 116, 108, 113)]).gaps.find((gap) => gap.candle3Index === 2)!;
  assert.equal(bull.status, 'PARTIALLY_MITIGATED');
  assert.equal(bull.maximumFillPercent, .5);
  assert.deepEqual([bull.remainingLowerBound, bull.remainingUpperBound], [100, 105]);
  const bear = run([...bearish(), candle(3, 88, 95, 84, 88)]).gaps.find((gap) => gap.candle3Index === 2)!;
  assert.equal(bear.maximumFillPercent, .5);
  assert.deepEqual([bear.remainingLowerBound, bear.remainingUpperBound], [95, 100]);
});

test('full mitigation and exact configured full threshold qualify', () => {
  const full = run([...bullish(), candle(3, 112, 114, 99, 101)]).gaps.find((gap) => gap.candle3Index === 2)!;
  assert.equal(full.status, 'FULLY_MITIGATED');
  assert.equal(full.maximumFillPercent, 1);
  assert.equal(full.fullyMitigatedAt, candle(3, 112, 114, 99, 101).closedAt);
  const threshold = run([...bullish(), candle(3, 112, 114, 105, 108)], { fullMitigationThresholdPercent: .5 }).gaps.find((gap) => gap.candle3Index === 2)!;
  assert.equal(threshold.status, 'FULLY_MITIGATED');
  const touch = run([...bullish(), candle(3, 112, 114, 110, 112)], { mitigationPolicy: 'TOUCH' }).gaps.find((gap) => gap.candle3Index === 2)!;
  assert.equal(touch.status, 'FULLY_MITIGATED');
});

test('invalidation policies are directional and outrank full mitigation', () => {
  const bullCandle = candle(3, 112, 114, 89, 90);
  const bull = run([...bullish(), bullCandle]).gaps.find((gap) => gap.candle3Index === 2)!;
  assert.equal(bull.status, 'INVALIDATED');
  assert.deepEqual(bull.lifecycleEventIds.map((id) => run([...bullish(), bullCandle]).lifecycleEvents.find((event) => event.id === id)?.eventType), ['CREATED', 'INVALIDATION']);
  const bear = run([...bearish(), candle(3, 88, 111, 85, 105)]).gaps.find((gap) => gap.candle3Index === 2)!;
  assert.equal(bear.status, 'INVALIDATED');
  const wickOnly = candle(3, 112, 114, 99, 105);
  assert.notEqual(run([...bullish(), wickOnly]).gaps.find((gap) => gap.candle3Index === 2)!.status, 'INVALIDATED');
  assert.equal(run([...bullish(), wickOnly], { invalidationPolicy: 'WICK_THROUGH_FAR_BOUNDARY' }).gaps.find((gap) => gap.candle3Index === 2)!.status, 'INVALIDATED');
  assert.equal(run([...bullish(), bullCandle], { invalidationPolicy: 'NONE' }).gaps.find((gap) => gap.candle3Index === 2)!.status, 'FULLY_MITIGATED');
});

test('expiration supports never, exact candle count, and exact timestamp', () => {
  const quiet = candle(3, 115, 120, 112, 116);
  assert.equal(run([...bullish(), quiet], { expirationPolicy: 'NEVER' }).gaps.find((gap) => gap.candle3Index === 2)!.status, 'ACTIVE');
  assert.equal(run([...bullish(), quiet], { expirationPolicy: 'AFTER_N_CANDLES', expirationCandles: 1 }).gaps.find((gap) => gap.candle3Index === 2)!.status, 'EXPIRED');
  assert.equal(run([...bullish(), quiet], { expirationPolicy: 'AFTER_N_MILLISECONDS', expirationMilliseconds: 60_000 }).gaps.find((gap) => gap.candle3Index === 2)!.status, 'EXPIRED');
});

const overlappingSequence = (): NormalizedCandle[] => [
  candle(0, 95, 100, 90, 95), candle(1, 102, 108, 98, 106), candle(2, 110, 110, 110, 110),
  candle(3, 112, 115, 111, 114), candle(4, 120, 125, 120, 122),
];

test('overlapping gaps stay separate or merge deterministically without opposite-direction merging', () => {
  const separate = run(overlappingSequence(), { overlappingGapPolicy: 'KEEP_SEPARATE', invalidationPolicy: 'NONE' });
  assert.ok(separate.gaps.filter((gap) => gap.direction === 'BULLISH').length >= 2);
  const merged = run(overlappingSequence(), { overlappingGapPolicy: 'MERGE_SAME_DIRECTION', invalidationPolicy: 'NONE' });
  const bullishMerged = merged.gaps.filter((gap) => gap.direction === 'BULLISH');
  assert.equal(bullishMerged.length, 1);
  assert.deepEqual([bullishMerged[0]!.lowerBound, bullishMerged[0]!.upperBound], [100, 120]);
  assert.ok(bullishMerged[0]!.sourceGapIds.length > 0);
  const withBear = run([...overlappingSequence(), candle(5, 90, 95, 85, 90)], { overlappingGapPolicy: 'MERGE_SAME_DIRECTION', invalidationPolicy: 'NONE' });
  assert.ok(withBear.gaps.some((gap) => gap.direction === 'BEARISH'));
});

test('nested gap rejection is explicit', () => {
  const values = [
    candle(0, 95, 100, 90, 95), candle(1, 105, 110, 95, 105), candle(2, 120, 130, 120, 125),
    candle(3, 106, 110, 105, 108), candle(4, 112, 114, 108, 112), candle(5, 115, 118, 115, 116),
  ];
  const result = run(values, { overlappingGapPolicy: 'REJECT_NESTED', invalidationPolicy: 'NONE' });
  assert.ok(result.rejectedCandidates.some((candidate) => candidate.rejectionReason === 'NESTED_GAP_REJECTED'));
});

test('terminal gaps stop evolving and historical events remain immutable', () => {
  const terminalInput = [...bullish(), candle(3, 112, 114, 99, 101)];
  const terminalResult = run(terminalInput), gap = terminalResult.gaps.find((value) => value.candle3Index === 2)!;
  const expanded = run([...terminalInput, candle(4, 101, 120, 80, 110)]);
  const same = expanded.gaps.find((value) => value.id === gap.id)!;
  assert.deepEqual(same, gap);
  assert.deepEqual(expanded.lifecycleEvents.slice(0, terminalResult.lifecycleEvents.length), terminalResult.lifecycleEvents);
});

test('batch normalizes input while incremental output is byte-identical and replay-safe', () => {
  const values = [...bullish(), candle(3, 112, 116, 105, 112)];
  const batch = run(values), reversed = run([...values].reverse());
  assert.equal(JSON.stringify(reversed), JSON.stringify(batch));
  const incremental = createFairValueGapLifecycleDetector();
  values.forEach((value) => incremental.pushCandle(value));
  assert.equal(JSON.stringify(incremental.getResult()), JSON.stringify(batch));
  assert.ok(incremental.getNewLifecycleEvents().length > 0);
  assert.deepEqual(incremental.getNewLifecycleEvents(), []);
  assert.throws(() => incremental.pushCandle(candle(2, 100, 101, 99, 100)), /ascending|Duplicate/);
  incremental.reset();
  assert.deepEqual(incremental.getAllGaps(), []);
  assert.deepEqual(incremental.getRejectedCandidates(), []);
});

test('duplicates, invalid OHLC, non-positive prices, and incomplete candles are explicit', () => {
  const duplicate = bullish()[0]!;
  assert.throws(() => run([duplicate, duplicate]), (error) => error instanceof FairValueGapLifecycleError && error.code === 'DUPLICATE_CANDLE');
  assert.throws(() => run([{ ...duplicate, high: 80 }]), /contain.*OHLC|geometry/i);
  assert.throws(() => run([{ ...duplicate, close: 0 }]), /positive and finite/);
  const incomplete = run([...bullish(), candle(3, 112, 116, 105, 112, false)]);
  assert.match(incomplete.warnings[0]!, /Ignored incomplete/);
});

test('stable IDs, lifecycle IDs, evidence, immutability, and serialization are deterministic', () => {
  const first = run([...bullish(), candle(3, 112, 116, 105, 112)]), second = run(structuredClone([...bullish(), candle(3, 112, 116, 105, 112)]));
  assert.equal(first.gaps[0]!.id, second.gaps[0]!.id);
  assert.equal(first.lifecycleEvents[0]!.id, second.lifecycleEvents[0]!.id);
  assert.equal(serializeFairValueGapDetectionResult(first), serializeFairValueGapDetectionResult(second));
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.gaps[0]!.evidence));
  assert.match(first.gaps[0]!.evidence[2]!, /visible only when candle 3 closed/);
});

test('defaults are conservative and module has no forbidden dependencies', () => {
  assert.equal(DEFAULT_FAIR_VALUE_GAP_CONFIG.gapDefinition, 'WICK_TO_WICK');
  assert.equal(DEFAULT_FAIR_VALUE_GAP_CONFIG.mitigationPolicy, 'PERCENT_FILLED');
  assert.equal(DEFAULT_FAIR_VALUE_GAP_CONFIG.invalidationPolicy, 'CLOSE_THROUGH_FAR_BOUNDARY');
  assert.equal(DEFAULT_FAIR_VALUE_GAP_CONFIG.overlappingGapPolicy, 'KEEP_SEPARATE');
  const source = readFileSync('lib/market-intelligence/imbalance/fair-value-gap/fair-value-gap-lifecycle-detector.ts', 'utf8');
  assert.doesNotMatch(source, new RegExp('openai|anthropic|prompt|backtesting|app/api|Date[.]now|Math[.]random|randomUUID', 'i'));
  assert.doesNotMatch(source, /confirmed-swing|structure-reducer|break-of-structure|market-structure-shift|structural-sweep/);
});

test('research audit upgrades only the FVG lifecycle and remains blocked downstream', () => {
  const audit = readFileSync('research/strategies/xauusd-structure-pullback/1.0.0/detector-dependency-audit.md', 'utf8');
  assert.match(audit, /\| Fair value gap \| SUPPORTED \| `fair-value-gap-lifecycle@1\.0\.0`/);
  assert.match(audit, /\| Structural stop placement \| UNSUPPORTED \|/);
  assert.match(audit, /\| Liquidity target detection \| UNSUPPORTED \|/);
  assert.match(audit, /Conclusion: `DETECTOR_IMPLEMENTATION_REQUIRED`/);
});
