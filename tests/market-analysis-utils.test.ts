import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { candleGeometry, evidenceTimestamps, expectedCandleCloseTime, filterCompletedCandles, isCandleComplete, isSupportedTimeframe, normalizeRange, normalizeTimeframe, previousWindow, rollingMaximum, rollingMinimum, simpleAtr, simpleMovingAverage, timeframeDurationMs, trailingWindow, trueRange, validateCandles } from '../lib/market-intelligence/analysis-utils/index.ts';

const candle = (hour: number, values: Partial<NormalizedCandle> = {}): NormalizedCandle => ({ openedAt: `2026-01-15T${String(hour).padStart(2, '0')}:00:00.000Z`, closedAt: `2026-01-15T${String(hour + 1).padStart(2, '0')}:00:00.000Z`, open: 100, high: 105, low: 98, close: 103, volume: 10, complete: true, ...values });

test('candle validation reports finite values, geometry, order, volume, and history structurally', () => {
  const valid = validateCandles([candle(1), candle(2)], { minimumHistory: 2, requireFiniteVolume: true });
  assert.deepEqual(valid, { valid: true, sufficientData: true, candleCount: 2, minimumRequired: 2, issues: [] });
  const invalid = validateCandles([candle(2), candle(1, { high: 90, volume: null })], { minimumHistory: 3, requireFiniteVolume: true });
  assert.equal(invalid.valid, false); assert.equal(invalid.sufficientData, false);
  assert.deepEqual(invalid.issues.map((issue) => issue.code), ['INVALID_CANDLE_ORDER', 'IMPOSSIBLE_CANDLE_GEOMETRY', 'INVALID_VOLUME']);
});

test('completed candle filtering uses an explicit reference timestamp', () => {
  const result = filterCompletedCandles([candle(1), candle(2)], '2026-01-15T02:30:00.000Z');
  assert.equal(result.completed.length, 1); assert.equal(result.incomplete.length, 1); assert.equal(result.invalidTimestamp.length, 0);
});

test('rolling helpers expose sufficiency and never calculate misleading empty extrema', () => {
  assert.deepEqual(trailingWindow([1, 2, 3], 2), { values: [2, 3], requestedSize: 2, sampleCount: 2, sufficientData: true });
  assert.deepEqual(previousWindow([1, 2, 3, 4], 2, 1).values, [2, 3]);
  assert.equal(trailingWindow([1], 2).sufficientData, false);
  assert.equal(rollingMaximum([]), null); assert.equal(rollingMinimum([]), null);
  assert.equal(rollingMaximum([2, 7, 3]), 7); assert.equal(rollingMinimum([2, 7, 3]), 2);
  assert.deepEqual(evidenceTimestamps([candle(1), candle(2)]), ['2026-01-15T01:00:00.000Z', '2026-01-15T02:00:00.000Z']);
});

test('true range includes current range and gaps from the previous close', () => {
  assert.equal(trueRange({ high: 105, low: 98 }, { close: 100 }), 7);
  assert.equal(trueRange({ high: 110, low: 108 }, { close: 100 }), 10);
  assert.equal(trueRange({ high: 90, low: 92 }, { close: 100 }), null);
});

test('simple ATR matches the legacy simple-average formula and never returns zero for missing data', () => {
  const candles = Array.from({ length: 20 }, (_, index) => candle(index, { open: 100 + index, high: 104 + index, low: 98 + index, close: 102 + index }));
  const legacy = (values: NormalizedCandle[], period = 14) => { const source = values.slice(-period - 1); const ranges = source.slice(1).map((current, index) => Math.max(current.high - current.low, Math.abs(current.high - source[index].close), Math.abs(current.low - source[index].close))); return ranges.reduce((total, value) => total + value, 0) / ranges.length; };
  const result = simpleAtr(candles, 14);
  assert.equal(result.value, legacy(candles)); assert.equal(result.smoothingMethod, 'SIMPLE'); assert.equal(result.trueRangeCount, 14); assert.equal(result.candleCount, 15);
  const insufficient = simpleAtr(candles.slice(0, 14), 14);
  assert.equal(insufficient.value, null); assert.equal(insufficient.sufficientData, false);
});

test('SMA returns source and sufficiency metadata', () => {
  assert.deepEqual(simpleMovingAverage([1, 2, 3, 4], 3, 'close'), { value: 3, period: 3, source: 'close', sampleCount: 3, sufficientData: true });
  assert.equal(simpleMovingAverage([1, 2], 3).value, null);
});

test('candle geometry handles normal and zero-range candles explicitly', () => {
  assert.deepEqual(candleGeometry({ open: 100, high: 110, low: 90, close: 105 }), { bodySize: 5, totalRange: 20, upperWick: 5, lowerWick: 10, bodyToRangeRatio: 0.25, closeLocationInRange: 0.75 });
  const flat = candleGeometry({ open: 100, high: 100, low: 100, close: 100 });
  assert.equal(flat?.bodyToRangeRatio, null); assert.equal(flat?.closeLocationInRange, null);
});

test('range normalization exposes unavailable divisions', () => {
  assert.deepEqual(normalizeRange(90, 110, 100, 5), { absoluteRange: 20, midpoint: 100, normalizedPosition: 0.5, distancePercentOfPrice: 20, rangeToAtrRatio: 4 });
  assert.equal(normalizeRange(100, 100, 100, 0).normalizedPosition, null);
  assert.equal(normalizeRange(100, 90, 95, 5).absoluteRange, null);
});

test('canonical timeframe utilities normalize, validate, and calculate closes deterministically', () => {
  assert.equal(normalizeTimeframe(' 1h '), 'H1'); assert.equal(isSupportedTimeframe('H1'), true); assert.equal(isSupportedTimeframe('BAD'), false);
  assert.equal(timeframeDurationMs('H4'), 14_400_000); assert.equal(timeframeDurationMs('BAD'), null);
  assert.equal(expectedCandleCloseTime('2026-01-15T10:00:00.000Z', 'H1'), '2026-01-15T11:00:00.000Z');
  assert.equal(isCandleComplete(candle(10), '2026-01-15T11:00:00.000Z'), true);
});
