import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import type { MarketDataSnapshot, NormalizedCandle, TrendObservation } from '../lib/market-intelligence/contracts.ts';
import { TrendDetector } from '../lib/market-intelligence/detectors/trend/trend-detector.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRegistry } from '../lib/market-intelligence/registry/detector-registry.ts';
import { DetectorRunner } from '../lib/market-intelligence/runner/detector-runner.ts';

const base = Date.parse('2026-01-14T00:00:00.000Z');
function candles(closes: number[]): NormalizedCandle[] { return closes.map((close, index) => { const opened = base + index * 3_600_000; return { openedAt: new Date(opened).toISOString(), closedAt: new Date(opened + 3_600_000).toISOString(), open: close, high: close + 2, low: close - 2, close, volume: 100, complete: true }; }); }
function snapshot(values: NormalizedCandle[], timeframe = 'H1'): MarketDataSnapshot { const requestedAt = new Date(base + values.length * 3_600_000).toISOString(); return { id: `snapshot-${timeframe}`, snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1.0.0', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe, requestedAt, receivedAt: requestedAt, dataAsOf: values.at(-1)?.openedAt ?? requestedAt, freshness: { state: 'FRESH', dataAsOf: values.at(-1)?.openedAt ?? requestedAt, ageMs: 0, maximumAgeMs: 60_000 }, candles: values, validationWarnings: [] }; }
function legacyTrend(values: NormalizedCandle[]) { const average = (items: number[]) => items.reduce((total, item) => total + item, 0) / items.length; const fast = average(values.slice(-10).map((item) => item.close)); const slow = average(values.slice(-24).map((item) => item.close)); const latestClose = values.at(-1)!.close; return { fast, slow, latestClose, direction: fast > slow && latestClose > slow ? 'BULLISH' : fast < slow && latestClose < slow ? 'BEARISH' : 'RANGE' }; }

test('clear bullish and bearish fixtures exactly match the legacy formula', async () => {
  for (const closes of [Array.from({ length: 30 }, (_, index) => 100 + index), Array.from({ length: 30 }, (_, index) => 200 - index)]) {
    const values = candles(closes); const legacy = legacyTrend(values); const result = await new TrendDetector().execute(snapshot(values));
    assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.direction, legacy.direction); assert.equal(result.payload?.fastAverage.value, legacy.fast); assert.equal(result.payload?.slowAverage.value, legacy.slow); assert.equal(result.payload?.latestClose, legacy.latestClose);
  }
});

test('mixed fast/close comparisons preserve legacy RANGE classification', async () => {
  const cases = [[...Array(14).fill(100), ...Array(9).fill(120), 90], [...Array(14).fill(100), ...Array(9).fill(80), 110]];
  for (const closes of cases) { const values = candles(closes); const legacy = legacyTrend(values); const result = await new TrendDetector().execute(snapshot(values)); assert.equal(legacy.direction, 'RANGE'); assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.direction, 'RANGE'); }
});

test('equal averages and flat markets are successful RANGE observations', async () => {
  const result = await new TrendDetector().execute(snapshot(candles(Array(24).fill(100))));
  assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.direction, 'RANGE'); assert.equal(result.confidence, 0);
});

test('exactly 24 completed candles are sufficient and expose the complete schema', async () => {
  const values = candles(Array.from({ length: 24 }, (_, index) => 100 + index)); const legacy = legacyTrend(values); const result = await new TrendDetector().execute(snapshot(values, 'H4'));
  assert.deepEqual(result.payload?.fastAverage, { type: 'SMA', period: 10, value: legacy.fast }); assert.deepEqual(result.payload?.slowAverage, { type: 'SMA', period: 24, value: legacy.slow }); assert.equal(result.payload?.candleCount, 24); assert.equal(result.payload?.timeframe, 'H4'); assert.equal(result.payload?.lastCandleTime, values.at(-1)!.openedAt); assert.equal(result.evidence[0].candleTimes?.length, 24);
});

test('an incomplete final candle is excluded using the snapshot reference timestamp', async () => {
  const complete = candles(Array.from({ length: 24 }, (_, index) => 100 + index)); const final = candles([1])[0]; final.openedAt = new Date(base + 24 * 3_600_000).toISOString(); final.closedAt = new Date(base + 26 * 3_600_000).toISOString(); final.complete = false;
  const result = await new TrendDetector().execute(snapshot([...complete, final])); const legacy = legacyTrend(complete);
  assert.equal(result.payload?.direction, legacy.direction); assert.equal(result.payload?.latestClose, legacy.latestClose); assert.equal(result.payload?.lastCandleTime, complete.at(-1)!.openedAt);
});

test('fewer than 24 completed candles is explicit INSUFFICIENT_DATA, never RANGE', async () => {
  const result = await new TrendDetector().execute(snapshot(candles(Array.from({ length: 23 }, (_, index) => index + 100))));
  assert.equal(result.status, 'INSUFFICIENT_DATA'); assert.equal(result.payload, null); assert.equal(result.confidence, null); assert.match(result.warnings[0], /24 completed candles/);
});

test('malformed OHLC, geometry, ordering, and timestamps return ERROR', async () => {
  const fixtures: Array<[NormalizedCandle[], string]> = [];
  const nan = candles(Array(24).fill(100)); nan[0] = { ...nan[0], close: Number.NaN }; fixtures.push([nan, 'INVALID_OHLC']);
  const geometry = candles(Array(24).fill(100)); geometry[0] = { ...geometry[0], high: 90 }; fixtures.push([geometry, 'IMPOSSIBLE_CANDLE_GEOMETRY']);
  const order = candles(Array(24).fill(100)); order[1] = { ...order[1], openedAt: order[0].openedAt }; fixtures.push([order, 'INVALID_CANDLE_ORDER']);
  const timestamp = candles(Array(24).fill(100)); timestamp[0] = { ...timestamp[0], openedAt: 'bad' }; fixtures.push([timestamp, 'INVALID_TIMESTAMP']);
  for (const [values, errorCode] of fixtures) { const result = await new TrendDetector().execute(snapshot(values)); assert.equal(result.status, 'ERROR'); assert.equal(result.errorCode, errorCode); }
});

test('confidence is deterministic normalized strength metadata bounded to zero through one', async () => {
  const result = await new TrendDetector().execute(snapshot(candles(Array.from({ length: 30 }, (_, index) => 100 + index)))); assert.ok(result.payload); assert.ok(result.confidence !== null && result.confidence >= 0 && result.confidence <= 1);
  assert.equal(result.payload.fastSlowDifference, result.payload.fastAverage.value - result.payload.slowAverage.value); assert.equal(result.payload.closeToSlowDifference, result.payload.latestClose - result.payload.slowAverage.value);
  assert.equal(result.confidence, Math.min(1, (Math.abs(result.payload.fastSlowDifferencePercent!) + Math.abs(result.payload.closeToSlowDifferencePercent!)) / 2));
});

test('zero slow average uses explicit unavailable percentages', async () => {
  const result = await new TrendDetector().execute(snapshot(candles(Array(24).fill(0)))); assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.fastSlowDifferencePercent, null); assert.equal(result.payload?.closeToSlowDifferencePercent, null); assert.equal(result.confidence, 0);
});

test('detector is registered with reference metadata and all canonical timeframes', () => {
  const detector = createDetectorRegistry().get('trend'); assert.ok(detector); assert.equal(detector.version, '1.0.0'); assert.equal(detector.displayName, 'Trend Detector'); assert.equal(detector.deterministic, true); assert.equal(detector.metadata.supportsReplay, true); assert.equal(detector.metadata.experimental, true); assert.equal(detector.metadata.enabledByDefault, true); assert.ok(detector.supportedTimeframes.includes('H1'));
});

test('runner and ContextBuilder preserve multiple timeframe results, failures, and evidence', async () => {
  const registry = new DetectorRegistry().register(new TrendDetector()).freeze(); const runner = new DetectorRunner(registry, { createRunId: () => 'trend-run' });
  const h1Snapshot = snapshot(candles(Array.from({ length: 30 }, (_, index) => 100 + index)), 'H1'); const h4Snapshot = snapshot(candles(Array.from({ length: 30 }, (_, index) => 200 - index)), 'H4');
  const h1 = await runner.execute(h1Snapshot, ['trend']); const h4 = await runner.execute(h4Snapshot, ['trend']); const failed = await runner.execute(snapshot(candles(Array(23).fill(100))), ['trend']);
  const malformed = candles(Array(24).fill(100)); malformed[0] = { ...malformed[0], high: 90 }; const error = await runner.execute(snapshot(malformed, 'M15'), ['trend']);
  const combined = { ...h1, runId: 'combined', detectorResults: [...h1.detectorResults, ...h4.detectorResults, ...failed.detectorResults, ...error.detectorResults], detectorFailures: error.detectorFailures, successfulCount: 3, failedCount: 1 };
  const context = new AnalysisContextBuilder({ now: () => '2026-01-15T12:00:00.000Z' }).build(h1Snapshot, combined);
  assert.equal((context.detectorResultsByTimeframe.H1[0].payload as TrendObservation).direction, 'BULLISH'); assert.equal((context.detectorResultsByTimeframe.H4[0].payload as TrendObservation).direction, 'BEARISH'); assert.equal(context.detectorResultsByTimeframe.H1[1].status, 'INSUFFICIENT_DATA'); assert.equal(context.detectorResultsByTimeframe.M15[0].status, 'ERROR'); assert.ok(context.conflicts.some((conflict) => conflict.type === 'DETECTOR_FAILURE')); assert.equal(context.detectorResults[0].evidence[0].metadata?.detectorVersion, '1.0.0'); assert.deepEqual(JSON.parse(JSON.stringify(context)), context);
});

test('trend output contains no alignment, BUY/SELL, strategy, risk, readiness, or decision result', async () => {
  const result = await new TrendDetector().execute(snapshot(candles(Array.from({ length: 30 }, (_, index) => 100 + index))));
  assert.doesNotMatch(JSON.stringify(result), /aligned|BUY|SELL|strategy|authorization|riskAllowed|readiness|takeProfit|stopLoss|suggestedDirection/);
});
