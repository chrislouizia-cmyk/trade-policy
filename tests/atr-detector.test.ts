import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import type { AtrObservation, MarketDataSnapshot, NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { AtrDetector } from '../lib/market-intelligence/detectors/atr/atr-detector.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRegistry } from '../lib/market-intelligence/registry/detector-registry.ts';
import { DetectorRunner } from '../lib/market-intelligence/runner/detector-runner.ts';

const base = Date.parse('2026-01-14T00:00:00.000Z');
function candles(count = 20): NormalizedCandle[] { return Array.from({ length: count }, (_, index) => { const opened = base + index * 3_600_000; return { openedAt: new Date(opened).toISOString(), closedAt: new Date(opened + 3_600_000).toISOString(), open: 100 + index, high: 105 + index, low: 98 + index, close: 103 + index, volume: 100, complete: true }; }); }
function snapshot(timeframe = 'H1', values = candles()): MarketDataSnapshot { const requestedAt = new Date(base + 24 * 3_600_000).toISOString(); return { id: `snapshot-${timeframe}`, snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1.0.0', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe, requestedAt, receivedAt: requestedAt, dataAsOf: values.at(-1)?.openedAt ?? requestedAt, freshness: { state: 'FRESH', dataAsOf: values.at(-1)?.openedAt ?? requestedAt, ageMs: 0, maximumAgeMs: 60_000 }, candles: values, validationWarnings: [] }; }

test('ATR detector calculates legacy-compatible SIMPLE ATR from completed candles', async () => {
  const values = candles(); const result = await new AtrDetector().execute(snapshot('H1', values));
  const source = values.slice(-15); const legacyRanges = source.slice(1).map((current, index) => Math.max(current.high - current.low, Math.abs(current.high - source[index].close), Math.abs(current.low - source[index].close))); const legacyAtr = legacyRanges.reduce((total, value) => total + value, 0) / legacyRanges.length;
  assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.atr, legacyAtr); assert.equal(result.payload?.smoothingMethod, 'SIMPLE');
  assert.equal(result.payload?.period, 14); assert.equal(result.payload?.candleCount, 15); assert.equal(result.payload?.trueRangeCount, 14);
  assert.equal(result.payload?.unit, 'RAW_PRICE'); assert.equal(result.payload?.normalizedAtrPercent, legacyAtr / source.at(-1)!.close * 100);
  assert.equal(result.evidence[0].candleTimes?.length, 15);
});

test('ATR uses only completed candles according to the snapshot reference timestamp', async () => {
  const values = candles(); const incomplete = { ...values.at(-1)!, openedAt: new Date(base + 24 * 3_600_000).toISOString(), closedAt: new Date(base + 25 * 3_600_000).toISOString(), complete: false };
  const result = await new AtrDetector().execute(snapshot('H1', [...values, incomplete]));
  assert.equal(result.payload?.lastCandleTime, values.at(-1)!.openedAt);
});

test('missing history and no completed candles are explicit INSUFFICIENT_DATA with null payload', async () => {
  const short = await new AtrDetector().execute(snapshot('H1', candles(14)));
  assert.equal(short.status, 'INSUFFICIENT_DATA'); assert.equal(short.payload, null); assert.match(short.warnings[0], /15 completed candles/);
  const future = candles(20).map((item) => ({ ...item, closedAt: '2027-01-01T00:00:00.000Z', complete: false }));
  const empty = await new AtrDetector().execute(snapshot('H1', future));
  assert.equal(empty.status, 'INSUFFICIENT_DATA'); assert.equal(empty.payload, null);
});

test('malformed OHLC, timestamps, and impossible geometry return ERROR', async () => {
  const malformed = candles(); malformed[0] = { ...malformed[0], close: Number.NaN };
  assert.equal((await new AtrDetector().execute(snapshot('H1', malformed))).status, 'ERROR');
  const geometry = candles(); geometry[0] = { ...geometry[0], high: 1 };
  assert.equal((await new AtrDetector().execute(snapshot('H1', geometry))).errorCode, 'IMPOSSIBLE_CANDLE_GEOMETRY');
  const timestamp = candles(); timestamp[0] = { ...timestamp[0], openedAt: 'bad' };
  assert.equal((await new AtrDetector().execute(snapshot('H1', timestamp))).errorCode, 'INVALID_TIMESTAMP');
});

test('ATR metadata and dormant registry registration are complete', () => {
  const detector = createDetectorRegistry().get('atr'); assert.ok(detector);
  assert.equal(detector.version, '1.0.0'); assert.equal(detector.displayName, 'ATR Detector'); assert.equal(detector.metadata.supportsReplay, true); assert.equal(detector.metadata.experimental, true); assert.equal(detector.metadata.enabledByDefault, true); assert.ok(detector.supportedTimeframes.includes('H1'));
});

test('runner and context preserve ATR evidence, insufficient data, and multiple timeframe grouping', async () => {
  const registry = new DetectorRegistry().register(new AtrDetector()).freeze(); const runner = new DetectorRunner(registry, { createRunId: () => 'atr-run' });
  const h1 = await runner.execute(snapshot('H1'), ['atr']); const h4 = await runner.execute(snapshot('H4'), ['atr']);
  const combined = { ...h1, runId: 'combined-run', detectorResults: [...h1.detectorResults, ...h4.detectorResults], successfulCount: 2 };
  const context = new AnalysisContextBuilder({ now: () => '2026-01-15T00:00:00.000Z' }).build(snapshot('H1'), combined);
  assert.equal((context.detectorResultsByTimeframe.H1[0].payload as AtrObservation).timeframe, 'H1');
  assert.equal((context.detectorResultsByTimeframe.H4[0].payload as AtrObservation).timeframe, 'H4');
  assert.deepEqual(JSON.parse(JSON.stringify(context)).detectorResults[0].evidence, context.detectorResults[0].evidence);
  const insufficient = await runner.execute(snapshot('H1', candles(2)), ['atr']); const insufficientContext = new AnalysisContextBuilder().build(snapshot('H1', candles(2)), insufficient);
  assert.equal(insufficientContext.detectorResults[0].status, 'INSUFFICIENT_DATA');
});

test('ATR output contains observations only and cannot express strategy, risk, or decisions', async () => {
  const serialized = JSON.stringify(await new AtrDetector().execute(snapshot()));
  assert.doesNotMatch(serialized, /strategy|authorization|riskAllowed|BUY|SELL|takeProfit|stopLoss/);
});
