import assert from 'node:assert/strict';
import test from 'node:test';
import type { MarketDataSnapshot, NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { LiquiditySweepDetector } from '../lib/market-intelligence/detectors/liquidity-sweep/liquidity-sweep-detector.ts';

const base = Date.parse('2026-01-15T00:00:00.000Z');
const candle = (index: number, open = 100, high = 110, low = 90, close = 100): NormalizedCandle => ({ openedAt: new Date(base + index * 3_600_000).toISOString(), closedAt: new Date(base + (index + 1) * 3_600_000).toISOString(), open, high, low, close, volume: 100, complete: true });
const reference = () => Array.from({ length: 19 }, (_, index) => candle(index));
const snapshot = (values: NormalizedCandle[], timeframe = 'H1'): MarketDataSnapshot => { const requestedAt = new Date(base + values.length * 3_600_000).toISOString(); return { id: `snapshot-${timeframe}`, snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1.0.0', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe, requestedAt, receivedAt: requestedAt, dataAsOf: values.at(-1)?.openedAt ?? requestedAt, freshness: { state: 'FRESH', dataAsOf: values.at(-1)?.openedAt ?? requestedAt, ageMs: 0, maximumAgeMs: 60_000 }, candles: values, validationWarnings: [] }; };
const legacy = (values: NormalizedCandle[]) => { const prior = values.slice(-20, -8); const current = values.at(-1)!; const high = Math.max(...prior.map((item) => item.high)); const low = Math.min(...prior.map((item) => item.low)); const highSide = current.high > high && current.close < high; const lowSide = current.low < low && current.close > low; return highSide && lowSide ? 'BOTH' : highSide ? 'HIGH_SIDE' : lowSide ? 'LOW_SIDE' : 'NONE'; };

test('high-side, low-side, and both-side sweeps preserve exact legacy conditions', async () => {
  for (const event of [candle(19, 100, 111, 99, 109), candle(19, 100, 101, 89, 91), candle(19, 100, 111, 89, 100)]) { const values = [...reference(), event]; const result = await new LiquiditySweepDetector().execute(snapshot(values)); assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.side, legacy(values)); assert.equal(result.payload?.highSideSweep, ['HIGH_SIDE', 'BOTH'].includes(result.payload!.side)); assert.equal(result.payload?.lowSideSweep, ['LOW_SIDE', 'BOTH'].includes(result.payload!.side)); }
});

test('strict equality, close outside, and no breach are successful NONE observations', async () => {
  const events = [candle(19, 100, 111, 99, 110), candle(19, 100, 101, 89, 90), candle(19, 100, 111, 99, 111), candle(19, 100, 101, 89, 89), candle(19, 100, 105, 95, 100)];
  for (const event of events) { const values = [...reference(), event]; const result = await new LiquiditySweepDetector().execute(snapshot(values)); assert.equal(legacy(values), 'NONE'); assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.side, 'NONE'); assert.equal(result.confidence, 1); }
  const flat = Array.from({ length: 19 }, (_, index) => candle(index, 100, 100, 100, 100)); assert.equal((await new LiquiditySweepDetector().execute(snapshot([...flat, candle(19, 100, 100, 100, 100)]))).payload?.side, 'NONE');
});

test('penetration metadata and exact legacy prior-window evidence are preserved', async () => {
  const values = [...reference(), candle(19, 100, 112, 88, 100)]; const result = await new LiquiditySweepDetector().execute(snapshot(values)); assert.equal(result.payload?.side, 'BOTH'); assert.equal(result.payload?.highPenetration, 2); assert.equal(result.payload?.lowPenetration, 2); assert.equal(result.payload?.referenceWindowSize, 12); assert.equal(result.payload?.candleCount, 13); assert.equal(result.evidence[0].candleTimes?.length, 13); assert.equal(result.payload?.referenceStartTime, values[0].openedAt); assert.equal(result.payload?.referenceEndTime, values[11].openedAt); assert.equal(result.payload?.eventCandleTime, values[19].openedAt);
});

test('insufficient history and incomplete event candle remain explicit', async () => {
  assert.equal((await new LiquiditySweepDetector().execute(snapshot(reference()))).status, 'INSUFFICIENT_DATA'); const event = candle(19, 100, 111, 99, 109); event.closedAt = new Date(base + 21 * 3_600_000).toISOString(); event.complete = false; const result = await new LiquiditySweepDetector().execute(snapshot([...reference(), event])); assert.equal(result.status, 'INSUFFICIENT_DATA'); assert.equal(result.payload, null);
});

test('zero reference prices produce explicit unavailable penetration percentages', async () => {
  const refs = Array.from({ length: 19 }, (_, index) => candle(index, -1, 0, -2, -1)); const result = await new LiquiditySweepDetector().execute(snapshot([...refs, candle(19, -1, 1, -1.5, -1)])); assert.equal(result.payload?.highSideSweep, true); assert.equal(result.payload?.highPenetrationPercent, null);
});

test('malformed data and missing timeframe produce ERROR or INSUFFICIENT_DATA', async () => {
  const fixtures: Array<[NormalizedCandle[], string]> = []; const nan = [...reference(), candle(19)]; nan[0] = { ...nan[0], high: Number.NaN }; fixtures.push([nan, 'INVALID_OHLC']); const geometry = [...reference(), candle(19)]; geometry[0] = { ...geometry[0], low: 120 }; fixtures.push([geometry, 'IMPOSSIBLE_CANDLE_GEOMETRY']); const duplicate = [...reference(), candle(19)]; duplicate[1] = { ...duplicate[1], openedAt: duplicate[0].openedAt }; fixtures.push([duplicate, 'INVALID_CANDLE_ORDER']); const malformed = [...reference(), candle(19)]; malformed[0] = { ...malformed[0], openedAt: 'bad' }; fixtures.push([malformed, 'INVALID_TIMESTAMP']);
  for (const [values, code] of fixtures) { const result = await new LiquiditySweepDetector().execute(snapshot(values)); assert.equal(result.status, 'ERROR'); assert.equal(result.errorCode, code); }
  assert.equal((await new LiquiditySweepDetector().execute(snapshot([...reference(), candle(19)], ''))).status, 'INSUFFICIENT_DATA');
});

test('recent seven-candle levels do not replace the legacy prior reference window', async () => {
  const prior = Array.from({ length: 12 }, (_, index) => candle(index, 100, 110, 90, 100));
  const recent = Array.from({ length: 7 }, (_, index) => candle(index + 12, 100, 120, 80, 100));
  const values = [...prior, ...recent, candle(19, 100, 111, 89, 100)];
  const result = await new LiquiditySweepDetector().execute(snapshot(values));
  assert.equal(result.payload?.referenceHigh, 110);
  assert.equal(result.payload?.referenceLow, 90);
  assert.equal(result.payload?.side, 'BOTH');
  assert.equal(result.payload?.side, legacy(values));
});
