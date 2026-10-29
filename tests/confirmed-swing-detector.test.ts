import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { MarketDataSnapshot, NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { ConfirmedSwingDetector, createSwingDetector, detectConfirmedSwings, serializeSwingDetection, SwingDetectionError, type SwingDetectorConfig } from '../lib/market-intelligence/detectors/confirmed-swing/index.ts';

const candle = (index: number, high: number, low: number, patch: Partial<NormalizedCandle> = {}): NormalizedCandle => ({
  openedAt: new Date(Date.UTC(2024, 0, 1, 0, index * 15)).toISOString(),
  closedAt: new Date(Date.UTC(2024, 0, 1, 0, (index + 1) * 15)).toISOString(),
  open: (high + low) / 2,
  high,
  low,
  close: (high + low) / 2,
  volume: 100,
  complete: true,
  ...patch,
});
const series = (highs: readonly number[], lows = highs.map((high) => high - 2)): NormalizedCandle[] => highs.map((high, index) => candle(index, high, lows[index]!));
const config = (patch: Partial<SwingDetectorConfig> = {}): SwingDetectorConfig => ({ leftBars: 2, rightBars: 2, equalityPolicy: 'STRICT', ...patch });

test('detects basic confirmed swing high and low with true first-known timestamps', () => {
  const high = detectConfirmedSwings(series([1, 2, 5, 2, 1]), config()).swings;
  assert.equal(high.length, 1);
  assert.deepEqual({ direction: high[0]!.direction, pivotIndex: high[0]!.pivotIndex, confirmedIndex: high[0]!.confirmedIndex, price: high[0]!.price }, { direction: 'HIGH', pivotIndex: 2, confirmedIndex: 4, price: 5 });
  assert.equal(high[0]!.pivotAt, candle(2, 5, 3).openedAt);
  assert.equal(high[0]!.confirmedAt, candle(4, 1, -1).closedAt);
  assert.notEqual(high[0]!.pivotAt, high[0]!.confirmedAt);

  const low = detectConfirmedSwings(series([5, 4, 3, 4, 5], [4, 3, 0, 3, 4]), config()).swings;
  assert.equal(low.length, 1);
  assert.equal(low[0]!.direction, 'LOW');
  assert.equal(low[0]!.price, 0);
});

test('incremental detector never emits before right confirmation closes', () => {
  const detector = createSwingDetector(config());
  const input = series([1, 2, 5, 2, 1]);
  for (let index = 0; index < 4; index++) assert.deepEqual(detector.push(input[index]!), []);
  const emitted = detector.push(input[4]!);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]!.confirmedIndex, 4);
  assert.ok(Date.parse(emitted[0]!.confirmedAt) <= Date.parse(input[4]!.closedAt));
});

test('batch and incremental processing produce byte-identical final swings', () => {
  const input = series([1, 2, 5, 2, 1, 0, 3, 6, 3, 1], [-1, 0, 3, 0, -1, -4, 0, 4, 0, -1]);
  const batch = detectConfirmedSwings(input, config()).swings;
  const incremental = createSwingDetector(config());
  input.forEach((value) => incremental.push(value));
  assert.equal(JSON.stringify(incremental.getAllConfirmedSwings()), JSON.stringify(batch));
});

test('final unconfirmed candidates and insufficient histories are not emitted', () => {
  assert.deepEqual(detectConfirmedSwings([], config()).swings, []);
  assert.deepEqual(detectConfirmedSwings(series([1]), config()).swings, []);
  assert.deepEqual(detectConfirmedSwings(series([1, 2, 3, 8]), config()).swings, []);
});

test('STRICT equality invalidates equal highs and lows', () => {
  assert.equal(detectConfirmedSwings(series([1, 5, 5, 2, 1]), { leftBars: 1, rightBars: 1, equalityPolicy: 'STRICT' }).swings.filter((swing) => swing.direction === 'HIGH').length, 0);
  const lows = [4, 0, 0, 3, 4];
  assert.equal(detectConfirmedSwings(series([5, 2, 2, 5, 6], lows), { leftBars: 1, rightBars: 1, equalityPolicy: 'STRICT' }).swings.filter((swing) => swing.direction === 'LOW').length, 0);
});

test('equality policies apply only to their configured side and record conflicts', () => {
  const equalLeft = series([1, 5, 5, 2, 1]);
  const allowed = detectConfirmedSwings(equalLeft, { leftBars: 1, rightBars: 1, equalityPolicy: 'ALLOW_EQUAL_LEFT' }).swings.find((swing) => swing.pivotIndex === 2 && swing.direction === 'HIGH');
  assert.equal(allowed?.equalPriceConflict, true);
  assert.equal(detectConfirmedSwings(equalLeft, { leftBars: 1, rightBars: 1, equalityPolicy: 'ALLOW_EQUAL_RIGHT' }).swings.some((swing) => swing.pivotIndex === 2 && swing.direction === 'HIGH'), false);
  const equalRight = series([1, 2, 5, 5, 1]);
  assert.equal(detectConfirmedSwings(equalRight, { leftBars: 1, rightBars: 1, equalityPolicy: 'ALLOW_EQUAL_RIGHT' }).swings.find((swing) => swing.pivotIndex === 2)?.equalPriceConflict, true);
  assert.ok(detectConfirmedSwings(equalLeft, { leftBars: 1, rightBars: 1, equalityPolicy: 'ALLOW_EQUAL_BOTH' }).swings.length > 0);
});

test('leftBars changes eligibility and rightBars changes confirmation timing', () => {
  const input = series([9, 1, 8, 2, 3, 2, 1]);
  assert.equal(detectConfirmedSwings(input, { leftBars: 1, rightBars: 1, equalityPolicy: 'STRICT' }).swings.some((swing) => swing.pivotIndex === 2 && swing.direction === 'HIGH'), true);
  assert.equal(detectConfirmedSwings(input, { leftBars: 2, rightBars: 1, equalityPolicy: 'STRICT' }).swings.some((swing) => swing.pivotIndex === 2 && swing.direction === 'HIGH'), false);
  const shortConfirmation = detectConfirmedSwings(series([1, 2, 5, 2, 1]), { leftBars: 2, rightBars: 1, equalityPolicy: 'STRICT' }).swings.find((swing) => swing.pivotIndex === 2)!;
  const longConfirmation = detectConfirmedSwings(series([1, 2, 5, 2, 1]), config()).swings.find((swing) => swing.pivotIndex === 2)!;
  assert.equal(shortConfirmation.confirmedIndex, 3);
  assert.equal(longConfirmation.confirmedIndex, 4);
});

test('out-of-order, duplicate, missing timestamps, incomplete, and malformed candles are rejected', () => {
  const valid = series([1, 2, 3, 2, 1]);
  assert.throws(() => detectConfirmedSwings([valid[1]!, valid[0]!], config()), (error) => error instanceof SwingDetectionError && error.code === 'INVALID_CANDLES');
  assert.throws(() => detectConfirmedSwings([valid[0]!, { ...valid[1]!, openedAt: valid[0]!.openedAt }], config()), /INVALID_CANDLE_ORDER/);
  assert.throws(() => detectConfirmedSwings([{ ...valid[0]!, openedAt: '' }], config()), /INVALID_TIMESTAMP/);
  assert.throws(() => detectConfirmedSwings([{ ...valid[0]!, complete: false }], config()), (error) => error instanceof SwingDetectionError && error.code === 'INCOMPLETE_CANDLE');
  assert.throws(() => detectConfirmedSwings([{ ...valid[0]!, high: -10 }], config()), /IMPOSSIBLE_CANDLE_GEOMETRY/);
  assert.throws(() => detectConfirmedSwings([{ ...valid[0]!, closedAt: valid[0]!.openedAt }], config()), /INVALID_CANDLE_INTERVAL/);
});

test('flat candles and large gaps are valid data without special-case behavior', () => {
  assert.deepEqual(detectConfirmedSwings([candle(0, 1, 1), candle(1, 1, 1), candle(2, 1, 1)], { leftBars: 1, rightBars: 1, equalityPolicy: 'STRICT' }).swings, []);
  const gap = series([1, 2, 1_000, 2, 1]);
  assert.equal(detectConfirmedSwings(gap, config()).swings.find((swing) => swing.direction === 'HIGH')?.price, 1_000);
});

test('stable IDs are deterministic and include optional dataset context', () => {
  const input = series([1, 2, 5, 2, 1]);
  const first = detectConfirmedSwings(input, config()).swings[0]!.id;
  assert.equal(detectConfirmedSwings(input, config()).swings[0]!.id, first);
  assert.notEqual(detectConfirmedSwings(input, config({ context: { instrument: 'XAUUSD', timeframe: 'M15', datasetId: 'A' } })).swings[0]!.id, first);
  assert.match(first, /^confirmed-swing:[0-9a-f]{16}$/);
});

test('incremental newly-confirmed reads are idempotent and reset clears all state', () => {
  const detector = createSwingDetector(config());
  series([1, 2, 5, 2, 1]).forEach((value) => detector.push(value));
  assert.equal(detector.getNewlyConfirmedSwings().length, 1);
  assert.deepEqual(detector.getNewlyConfirmedSwings(), []);
  assert.equal(detector.getAllConfirmedSwings().length, 1);
  detector.reset();
  assert.deepEqual(detector.getAllConfirmedSwings(), []);
});

test('absolute prominence formula is pivot distance from the nearest surrounding extreme', () => {
  const result = detectConfirmedSwings(series([1, 3, 7, 4, 2]), config({ minimumProminence: 3 })).swings[0]!;
  assert.equal(result.prominence, 3);
  assert.ok(result.strength >= 0 && result.strength <= 1);
  assert.equal(detectConfirmedSwings(series([1, 3, 7, 4, 2]), config({ minimumProminence: 3.01 })).swings.length, 0);
});

test('ATR prominence uses only candles available at confirmedAt', () => {
  const before = Array.from({ length: 14 }, (_, index) => candle(index, 10 + (index % 2), 8 + (index % 2)));
  const input = [...before, candle(14, 20, 9), candle(15, 12, 9), candle(16, 11, 8), candle(17, 500, 1)];
  const configured = config({ minimumProminenceAtrMultiple: .1, atrPeriod: 14 });
  const withFuture = detectConfirmedSwings(input, configured).swings.find((swing) => swing.pivotIndex === 14 && swing.direction === 'HIGH')!;
  const atConfirmation = detectConfirmedSwings(input.slice(0, 17), configured).swings.find((swing) => swing.pivotIndex === 14 && swing.direction === 'HIGH')!;
  assert.equal(withFuture.prominenceAtrMultiple, atConfirmation.prominenceAtrMultiple);
  assert.equal(withFuture.id, atConfirmation.id);
  assert.equal(withFuture.confirmedAt, input[16]!.closedAt);
});

test('insufficient ATR history skips safely with an explicit deterministic warning', () => {
  const result = detectConfirmedSwings(series([1, 2, 5, 2, 1]), config({ minimumProminenceAtrMultiple: 1, atrPeriod: 14 }));
  assert.deepEqual(result.swings, []);
  assert.match(result.warnings.join(' '), /ATR\(14\) is unavailable at confirmedAt/);
});

test('an outside candle may be both a confirmed high and low in stable order', () => {
  const input = [candle(0, 5, 2), candle(1, 6, 1), candle(2, 10, -5), candle(3, 6, 1), candle(4, 5, 2)];
  const swings = detectConfirmedSwings(input, config()).swings;
  assert.deepEqual(swings.map((swing) => swing.direction), ['HIGH', 'LOW']);
  assert.deepEqual(swings.map((swing) => swing.pivotIndex), [2, 2]);
});

test('emitted swing exposes pivot evidence only and cannot leak later candle values', () => {
  const input = [...series([1, 2, 5, 2, 1]), candle(5, 999_999, -999_999)];
  const swing = detectConfirmedSwings(input, config()).swings.find((value) => value.pivotIndex === 2)!;
  assert.deepEqual(Object.keys(swing.sourceCandle).sort(), ['close', 'high', 'low', 'open']);
  assert.doesNotMatch(JSON.stringify(swing), /999999/);
  assert.equal(swing.confirmedIndex, 4);
});

test('results are deeply immutable, canonical, JSON-safe, and contain no random behavior', () => {
  const result = detectConfirmedSwings(series([1, 2, 5, 2, 1]), config());
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.swings) && Object.isFrozen(result.swings[0]!.sourceCandle));
  assert.equal(serializeSwingDetection(result), serializeSwingDetection(detectConfirmedSwings(series([1, 2, 5, 2, 1]), config())));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('detector wrapper uses snapshot.requestedAt and remains outside default bootstrap', async () => {
  const candles = [...series([1, 2, 5, 2, 1]), candle(5, 9, 0, { complete: false, closedAt: '2024-01-02T00:00:00.000Z' })];
  const snapshot: MarketDataSnapshot = {
    id: 'snapshot', snapshotVersion: '1', provider: 'fixture', providerVersion: '1', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe: 'M15',
    requestedAt: candles[4]!.closedAt, receivedAt: candles[4]!.closedAt, dataAsOf: candles[4]!.closedAt,
    freshness: { state: 'FRESH', dataAsOf: candles[4]!.closedAt, ageMs: 0, maximumAgeMs: 60_000 }, candles, validationWarnings: [],
  };
  const detector = new ConfirmedSwingDetector(config());
  const result = await detector.execute(snapshot);
  assert.equal(result.status, 'DETECTED');
  assert.equal(result.payload?.swings.length, 1);
  assert.equal(detector.metadata.enabledByDefault, false);
  assert.equal(createDetectorRegistry().exists('confirmed-swing'), false);
});

test('research audit upgrades only confirmed swing high and low support', () => {
  const audit = readFileSync('research/strategies/xauusd-structure-pullback/1.0.0/detector-dependency-audit.md', 'utf8');
  assert.match(audit, /\| Swing high \| SUPPORTED \| `confirmed-swing@1\.0\.0`/);
  assert.match(audit, /\| Swing low \| SUPPORTED \| `confirmed-swing@1\.0\.0`/);
  assert.match(audit, /\| Break of structure \| (?:PARTIALLY_)?SUPPORTED \|/);
  assert.match(audit, /\| Market structure shift \| SUPPORTED \| `market-structure-shift@1\.0\.0`/);
  assert.match(audit, /Conclusion: `DETECTOR_IMPLEMENTATION_REQUIRED`/);
});
