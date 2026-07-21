import assert from 'node:assert/strict';
import test from 'node:test';
import type { MarketDataSnapshot, NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { BreakOfStructureDetector } from '../lib/market-intelligence/detectors/break-of-structure/break-of-structure-detector.ts';

const base = Date.parse('2026-01-15T00:00:00.000Z');
const candle = (index: number, open = 100, high = 110, low = 90, close = 100): NormalizedCandle => ({ openedAt: new Date(base + index * 3_600_000).toISOString(), closedAt: new Date(base + (index + 1) * 3_600_000).toISOString(), open, high, low, close, volume: 100, complete: true });
const reference = () => Array.from({ length: 7 }, (_, index) => candle(index));
const snapshot = (values: NormalizedCandle[], timeframe = 'H1', requestedOffset = values.length): MarketDataSnapshot => { const requestedAt = new Date(base + requestedOffset * 3_600_000).toISOString(); return { id: `snapshot-${timeframe}`, snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1.0.0', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe, requestedAt, receivedAt: requestedAt, dataAsOf: values.at(-1)?.openedAt ?? requestedAt, freshness: { state: 'FRESH', dataAsOf: values.at(-1)?.openedAt ?? requestedAt, ageMs: 0, maximumAgeMs: 60_000 }, candles: values, validationWarnings: [] }; };
const legacy = (values: NormalizedCandle[]) => { const recent = values.slice(-8, -1); const current = values.at(-1)!; const high = Math.max(...recent.map((item) => item.high)); const low = Math.min(...recent.map((item) => item.low)); return current.close > high ? 'BULLISH' : current.close < low ? 'BEARISH' : 'NONE'; };

test('bullish and bearish BOS preserve exact legacy close comparisons', async () => {
  for (const event of [candle(7, 100, 112, 99, 111), candle(7, 100, 101, 88, 89)]) { const values = [...reference(), event]; const result = await new BreakOfStructureDetector().execute(snapshot(values)); assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.direction, legacy(values)); assert.equal(result.payload?.bullishBreak, result.payload?.direction === 'BULLISH'); assert.equal(result.payload?.bearishBreak, result.payload?.direction === 'BEARISH'); assert.equal(result.payload?.breakDistance, 1); }
});

test('strict equality, wick-only breaches, no break, and flat ranges are successful NONE observations', async () => {
  const events = [candle(7, 100, 110, 99, 110), candle(7, 100, 101, 90, 90), candle(7, 100, 111, 99, 109), candle(7, 100, 101, 89, 91), candle(7, 100, 105, 95, 100)];
  for (const event of events) { const values = [...reference(), event]; const result = await new BreakOfStructureDetector().execute(snapshot(values)); assert.equal(legacy(values), 'NONE'); assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.direction, 'NONE'); assert.equal(result.payload?.breakPrice, null); assert.equal(result.payload?.breakDistance, null); assert.equal(result.payload?.breakDistancePercent, null); assert.equal(result.confidence, 1); }
  const flat = Array.from({ length: 7 }, (_, index) => candle(index, 100, 100, 100, 100)); const flatResult = await new BreakOfStructureDetector().execute(snapshot([...flat, candle(7, 100, 100, 100, 100)])); assert.equal(flatResult.payload?.direction, 'NONE');
});

test('exactly eight completed candles are sufficient and evidence preserves boundaries', async () => {
  const values = [...reference(), candle(7, 100, 112, 99, 111)]; const result = await new BreakOfStructureDetector().execute(snapshot(values)); assert.equal(result.payload?.referenceWindowSize, 7); assert.equal(result.payload?.candleCount, 8); assert.equal(result.payload?.referenceStartTime, values[0].openedAt); assert.equal(result.payload?.referenceEndTime, values[6].openedAt); assert.equal(result.payload?.eventCandleTime, values[7].openedAt); assert.equal(result.evidence[0].candleTimes?.length, 8);
});

test('insufficient history and incomplete event candle remain INSUFFICIENT_DATA', async () => {
  const short = await new BreakOfStructureDetector().execute(snapshot(reference())); assert.equal(short.status, 'INSUFFICIENT_DATA'); assert.equal(short.payload, null);
  const event = candle(7, 100, 112, 99, 111); event.closedAt = new Date(base + 9 * 3_600_000).toISOString(); event.complete = false; const incomplete = await new BreakOfStructureDetector().execute(snapshot([...reference(), event])); assert.equal(incomplete.status, 'INSUFFICIENT_DATA'); assert.equal(incomplete.payload, null);
});

test('safe percentage is unavailable for a zero break price', async () => {
  const refs = Array.from({ length: 7 }, (_, index) => candle(index, -1, 0, -2, -1)); const result = await new BreakOfStructureDetector().execute(snapshot([...refs, candle(7, 0, 2, -1, 1)])); assert.equal(result.payload?.direction, 'BULLISH'); assert.equal(result.payload?.breakPrice, 0); assert.equal(result.payload?.breakDistancePercent, null);
});

test('malformed candles, duplicate/descending timestamps, and missing timeframe have explicit semantics', async () => {
  const fixtures: Array<[NormalizedCandle[], string]> = []; const nan = [...reference(), candle(7)]; nan[0] = { ...nan[0], close: Number.NaN }; fixtures.push([nan, 'INVALID_OHLC']); const geometry = [...reference(), candle(7)]; geometry[0] = { ...geometry[0], high: 80 }; fixtures.push([geometry, 'IMPOSSIBLE_CANDLE_GEOMETRY']); const duplicate = [...reference(), candle(7)]; duplicate[1] = { ...duplicate[1], openedAt: duplicate[0].openedAt }; fixtures.push([duplicate, 'INVALID_CANDLE_ORDER']); const descending = [...reference(), candle(7)]; descending[1] = { ...descending[1], openedAt: new Date(base - 3_600_000).toISOString() }; fixtures.push([descending, 'INVALID_CANDLE_ORDER']); const malformed = [...reference(), candle(7)]; malformed[0] = { ...malformed[0], openedAt: 'bad' }; fixtures.push([malformed, 'INVALID_TIMESTAMP']);
  for (const [values, code] of fixtures) { const result = await new BreakOfStructureDetector().execute(snapshot(values)); assert.equal(result.status, 'ERROR'); assert.equal(result.errorCode, code); }
  const missing = await new BreakOfStructureDetector().execute(snapshot([...reference(), candle(7)], '')); assert.equal(missing.status, 'INSUFFICIENT_DATA');
});
