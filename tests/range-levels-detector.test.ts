import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import type { MarketDataSnapshot, NormalizedCandle, RangeLevelsObservation } from '../lib/market-intelligence/contracts.ts';
import { RangeLevelsDetector } from '../lib/market-intelligence/detectors/range-levels/range-levels-detector.ts';
import { calculateLegacyRangeLevels } from '../lib/market-intelligence/detectors/range-levels/range-levels-utils.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRegistry } from '../lib/market-intelligence/registry/detector-registry.ts';
import { DetectorRunner } from '../lib/market-intelligence/runner/detector-runner.ts';

const base = Date.parse('2026-01-14T00:00:00.000Z');
function candles(closes: number[]): NormalizedCandle[] { return closes.map((close, index) => { const opened = base + index * 3_600_000; return { openedAt: new Date(opened).toISOString(), closedAt: new Date(opened + 3_600_000).toISOString(), open: close, high: close + 3 + index % 2, low: close - 2 - index % 3, close, volume: 100, complete: true }; }); }
function snapshot(values: NormalizedCandle[], timeframe = 'H1'): MarketDataSnapshot { const requestedAt = new Date(base + values.length * 3_600_000).toISOString(); return { id: `snapshot-${timeframe}`, snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1.0.0', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe, requestedAt, receivedAt: requestedAt, dataAsOf: values.at(-1)?.openedAt ?? requestedAt, freshness: { state: 'FRESH', dataAsOf: values.at(-1)?.openedAt ?? requestedAt, ageMs: 0, maximumAgeMs: 60_000 }, candles: values, validationWarnings: [] }; }
function legacy(values: NormalizedCandle[]) { const recent = values.slice(-8, -1); const previous = values.slice(-20, -8); return { recentHigh: Math.max(...recent.map((item) => item.high)), recentLow: Math.min(...recent.map((item) => item.low)), previousHigh: Math.max(...previous.map((item) => item.high)), previousLow: Math.min(...previous.map((item) => item.low)) }; }

test('bullish, bearish, and flat fixtures have exact legacy rolling-level parity', async () => {
  const fixtures = [Array.from({ length: 25 }, (_, index) => 100 + index), Array.from({ length: 25 }, (_, index) => 200 - index), Array(25).fill(100)];
  for (const closes of fixtures) { const values = candles(closes); const expected = legacy(values); const result = await new RangeLevelsDetector().execute(snapshot(values)); assert.equal(result.status, 'DETECTED'); assert.ok(result.payload); assert.deepEqual({ recentHigh: result.payload.recentHigh, recentLow: result.payload.recentLow, previousHigh: result.payload.previousHigh, previousLow: result.payload.previousLow }, expected); assert.equal(result.payload.midpoint, (expected.recentHigh + expected.recentLow) / 2); assert.equal(result.payload.range, expected.recentHigh - expected.recentLow); }
});

test('exact 20-candle boundary preserves slice(-8,-1) and slice(-20,-8)', async () => {
  const values = candles(Array.from({ length: 20 }, (_, index) => 50 + index)); const expected = legacy(values); const calculation = calculateLegacyRangeLevels(values); const result = await new RangeLevelsDetector().execute(snapshot(values));
  assert.ok(calculation); assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.candleCount, 20); assert.equal(result.payload?.recentHigh, expected.recentHigh); assert.equal(result.payload?.previousLow, expected.previousLow); assert.equal(result.payload?.sourceStartTime, values[0].openedAt); assert.equal(result.payload?.sourceEndTime, values.at(-1)!.openedAt); assert.equal(result.payload?.lastCandleTime, values.at(-1)!.openedAt); assert.equal(result.evidence[0].candleTimes?.length, 20);
});

test('insufficient completed history returns INSUFFICIENT_DATA without zero levels', async () => {
  const result = await new RangeLevelsDetector().execute(snapshot(candles(Array(19).fill(100)))); assert.equal(result.status, 'INSUFFICIENT_DATA'); assert.equal(result.payload, null); assert.equal(result.confidence, null); assert.match(result.warnings[0], /20 completed candles/);
});

test('incomplete candles are excluded using the snapshot reference timestamp', async () => {
  const complete = candles(Array.from({ length: 20 }, (_, index) => 100 + index)); const incomplete = candles([500])[0]; incomplete.openedAt = new Date(base + 20 * 3_600_000).toISOString(); incomplete.closedAt = new Date(base + 22 * 3_600_000).toISOString(); incomplete.complete = false;
  const result = await new RangeLevelsDetector().execute(snapshot([...complete, incomplete])); const expected = legacy(complete); assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.recentHigh, expected.recentHigh); assert.equal(result.payload?.lastCandleTime, complete.at(-1)!.openedAt);
});

test('malformed OHLC, timestamps, order, and impossible geometry return ERROR', async () => {
  const fixtures: Array<[NormalizedCandle[], string]> = [];
  const nan = candles(Array(20).fill(100)); nan[0] = { ...nan[0], low: Number.NaN }; fixtures.push([nan, 'INVALID_OHLC']);
  const geometry = candles(Array(20).fill(100)); geometry[0] = { ...geometry[0], low: 110 }; fixtures.push([geometry, 'IMPOSSIBLE_CANDLE_GEOMETRY']);
  const timestamp = candles(Array(20).fill(100)); timestamp[0] = { ...timestamp[0], openedAt: 'bad' }; fixtures.push([timestamp, 'INVALID_TIMESTAMP']);
  const order = candles(Array(20).fill(100)); order[1] = { ...order[1], openedAt: order[0].openedAt }; fixtures.push([order, 'INVALID_CANDLE_ORDER']);
  for (const [values, code] of fixtures) { const result = await new RangeLevelsDetector().execute(snapshot(values)); assert.equal(result.status, 'ERROR'); assert.equal(result.errorCode, code); assert.equal(result.payload, null); }
});

test('detector is registered with required metadata', () => {
  const detector = createDetectorRegistry().get('range-levels'); assert.ok(detector); assert.equal(detector.version, '1.0.0'); assert.equal(detector.displayName, 'Range Levels Detector'); assert.equal(detector.deterministic, true); assert.equal(detector.metadata.supportsReplay, true); assert.equal(detector.metadata.experimental, true); assert.equal(detector.metadata.enabledByDefault, true); assert.ok(detector.supportedTimeframes.includes('H1'));
});

test('runner and ContextBuilder preserve multiple timeframes and JSON evidence', async () => {
  const registry = new DetectorRegistry().register(new RangeLevelsDetector()).freeze(); const runner = new DetectorRunner(registry, { createRunId: () => 'range-run' });
  const h1Snapshot = snapshot(candles(Array.from({ length: 25 }, (_, index) => 100 + index)), 'H1'); const h4Snapshot = snapshot(candles(Array.from({ length: 25 }, (_, index) => 200 - index)), 'H4');
  const h1 = await runner.execute(h1Snapshot, ['range-levels']); const h4 = await runner.execute(h4Snapshot, ['range-levels']); const combined = { ...h1, runId: 'combined', detectorResults: [...h1.detectorResults, ...h4.detectorResults], successfulCount: 2 };
  const context = new AnalysisContextBuilder({ now: () => '2026-01-15T12:00:00.000Z' }).build(h1Snapshot, combined);
  assert.equal((context.detectorResultsByTimeframe.H1[0].payload as RangeLevelsObservation).timeframe, 'H1'); assert.equal((context.detectorResultsByTimeframe.H4[0].payload as RangeLevelsObservation).timeframe, 'H4'); assert.equal(context.detectorResults[0].runId, 'range-run'); assert.equal(context.detectorResults[0].evidence[0].metadata?.detectorVersion, '1.0.0'); assert.deepEqual(JSON.parse(JSON.stringify(context)), context);
});

test('output contains neutral levels only with no BOS, sweep, ChoCH, pivot, or direction decision', async () => {
  const result = await new RangeLevelsDetector().execute(snapshot(candles(Array.from({ length: 25 }, (_, index) => 100 + index)))); assert.doesNotMatch(JSON.stringify(result), /bos|sweep|choch|pivot|BUY|SELL|suggestedDirection|readiness/i);
});
