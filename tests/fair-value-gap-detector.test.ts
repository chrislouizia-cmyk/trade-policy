import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import type { MarketDataSnapshot, NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { FairValueGapDetector } from '../lib/market-intelligence/detectors/fair-value-gap/fair-value-gap-detector.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRegistry } from '../lib/market-intelligence/registry/detector-registry.ts';
import { DetectorRunner } from '../lib/market-intelligence/runner/detector-runner.ts';
import { ShadowValidator } from '../lib/market-intelligence/shadow-validation/shadow-validator.ts';

const base = Date.parse('2026-04-01T00:00:00.000Z');
const candle = (index: number, open: number, high: number, low: number, close: number): NormalizedCandle => ({ openedAt: new Date(base + index * 3_600_000).toISOString(), closedAt: new Date(base + (index + 1) * 3_600_000).toISOString(), open, high, low, close, volume: 100, complete: true });
const snapshot = (candles: NormalizedCandle[], timeframe = 'H1'): MarketDataSnapshot => { const requestedAt = new Date(base + candles.length * 3_600_000).toISOString(); return { id: `fvg-${timeframe}`, snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe, requestedAt, receivedAt: requestedAt, dataAsOf: candles.at(-1)?.openedAt ?? requestedAt, freshness: { state: 'FRESH', dataAsOf: candles.at(-1)?.openedAt ?? requestedAt, ageMs: 0, maximumAgeMs: 60_000 }, candles, validationWarnings: [] }; };
const middle = candle(1, 105, 110, 100, 106);

test('bullish FVG preserves strict legacy classification and gap dimensions', async () => {
  const source = [candle(0, 100, 105, 95, 100), middle, candle(2, 108, 112, 106, 110)]; const result = await new FairValueGapDetector().execute(snapshot(source));
  assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.direction, 'BULLISH'); assert.equal(result.payload?.bullishGap, true); assert.equal(result.payload?.bearishGap, false); assert.equal(result.payload?.gapTop, 106); assert.equal(result.payload?.gapBottom, 105); assert.equal(result.payload?.gapSize, 1); assert.equal(result.payload?.gapSizePercent, 1 / 105 * 100); assert.equal(result.payload?.referenceCandleTime, source[0].openedAt); assert.equal(result.payload?.eventCandleTime, source[2].openedAt);
});

test('bearish FVG preserves strict legacy classification and gap dimensions', async () => {
  const result = await new FairValueGapDetector().execute(snapshot([candle(0, 100, 105, 95, 100), middle, candle(2, 90, 94, 85, 90)]));
  assert.equal(result.payload?.direction, 'BEARISH'); assert.equal(result.payload?.bearishGap, true); assert.equal(result.payload?.gapTop, 95); assert.equal(result.payload?.gapBottom, 94); assert.equal(result.payload?.gapSize, 1);
});

test('no gap and equality boundaries are successful NONE observations', async () => {
  for (const event of [candle(2, 100, 108, 96, 101), candle(2, 105, 110, 105, 106), candle(2, 94, 95, 90, 94)]) { const result = await new FairValueGapDetector().execute(snapshot([candle(0, 100, 105, 95, 100), middle, event])); assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.direction, 'NONE'); assert.equal(result.payload?.bullishGap, false); assert.equal(result.payload?.bearishGap, false); assert.equal(result.payload?.gapSize, null); }
});

test('incomplete latest candle is excluded using snapshot.requestedAt', async () => {
  const complete = [candle(0, 95, 100, 90, 95), candle(1, 100, 105, 95, 100), candle(2, 105, 110, 100, 105)]; const incomplete = { ...candle(3, 120, 125, 115, 120), complete: false, closedAt: new Date(base + 5 * 3_600_000).toISOString() }; const result = await new FairValueGapDetector().execute(snapshot([...complete, incomplete])); assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.eventCandleTime, complete[2].openedAt); assert.equal(result.payload?.direction, 'NONE');
});

test('insufficient history is explicit and never NONE', async () => {
  const result = await new FairValueGapDetector().execute(snapshot([candle(0, 100, 105, 95, 100), middle])); assert.equal(result.status, 'INSUFFICIENT_DATA'); assert.equal(result.payload, null); assert.equal(result.confidence, null);
});

test('malformed OHLC, geometry, ordering, and timestamps return ERROR', async () => {
  const valid = [candle(0, 100, 105, 95, 100), middle, candle(2, 108, 112, 106, 110)]; const fixtures: Array<[NormalizedCandle[], string]> = [];
  const nan = valid.map((item) => ({ ...item })); nan[0].high = Number.NaN; fixtures.push([nan, 'INVALID_OHLC']); const geometry = valid.map((item) => ({ ...item })); geometry[0].low = 110; fixtures.push([geometry, 'IMPOSSIBLE_CANDLE_GEOMETRY']); const duplicate = valid.map((item) => ({ ...item })); duplicate[1].openedAt = duplicate[0].openedAt; fixtures.push([duplicate, 'INVALID_CANDLE_ORDER']); const timestamp = valid.map((item) => ({ ...item })); timestamp[0].closedAt = 'invalid'; fixtures.push([timestamp, 'INVALID_TIMESTAMP']);
  for (const [candles, errorCode] of fixtures) { const result = await new FairValueGapDetector().execute(snapshot(candles)); assert.equal(result.status, 'ERROR'); assert.equal(result.errorCode, errorCode); assert.equal(result.payload, null); }
});

test('metadata, registry, runner, ContextBuilder, serialization, and shadow parity integrate', async () => {
  const detector = new FairValueGapDetector(); assert.deepEqual({ id: detector.id, version: detector.version, displayName: detector.displayName, deterministic: detector.deterministic, supportsReplay: detector.metadata.supportsReplay, experimental: detector.metadata.experimental, enabledByDefault: detector.metadata.enabledByDefault }, { id: 'fair-value-gap', version: '1.0.0', displayName: 'Fair Value Gap Detector', deterministic: true, supportsReplay: true, experimental: true, enabledByDefault: true }); assert.ok(createDetectorRegistry().exists('fair-value-gap'));
  const history = Array.from({ length: 27 }, (_, index) => candle(index, 90, 100, 80, 90)); const source = snapshot([...history, candle(27, 100, 105, 95, 100), candle(28, 105, 110, 100, 105), candle(29, 115, 120, 111, 115)]); const runner = new DetectorRunner(new DetectorRegistry().register(detector).freeze(), { createRunId: () => 'fvg-run' }); const summary = await runner.execute(source, ['fair-value-gap']); assert.equal(summary.detectorResults.length, 1); const context = new AnalysisContextBuilder({ now: () => source.requestedAt }).build(source, summary); assert.equal(context.detectorResultsByTimeframe.H1[0].detectorId, 'fair-value-gap'); assert.deepEqual(JSON.parse(JSON.stringify(context)), context);
  const report = new ShadowValidator().validate(source, context); const comparison = report.comparisons.find((item) => item.detectorId === 'fair-value-gap'); assert.equal(comparison?.status, 'MATCH'); assert.equal(comparison?.exactMatch, true); assert.doesNotMatch(JSON.stringify(summary.detectorResults[0]), /BUY|SELL|strategy|risk|readiness|orderBlock|mitigation/i);
});
