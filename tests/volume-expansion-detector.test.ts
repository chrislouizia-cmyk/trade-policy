import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import type { DetectorResult, MarketDataSnapshot, NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { VolumeExpansionDetector } from '../lib/market-intelligence/detectors/volume-expansion/volume-expansion-detector.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRegistry } from '../lib/market-intelligence/registry/detector-registry.ts';
import { DetectorRunner } from '../lib/market-intelligence/runner/detector-runner.ts';
import { ShadowValidator } from '../lib/market-intelligence/shadow-validation/shadow-validator.ts';

const base = Date.parse('2026-06-01T00:00:00.000Z');
const candle = (index: number, volume: number | null): NormalizedCandle => ({ openedAt: new Date(base + index * 3_600_000).toISOString(), closedAt: new Date(base + (index + 1) * 3_600_000).toISOString(), open: 100, high: 105, low: 95, close: 101, volume, complete: true });
const snapshot = (candles: NormalizedCandle[], timeframe = 'H1'): MarketDataSnapshot => { const requestedAt = new Date(base + Math.max(1, candles.length) * 3_600_000).toISOString(); return { id: `volume-${timeframe}`, snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe, requestedAt, receivedAt: requestedAt, dataAsOf: candles.at(-1)?.openedAt ?? requestedAt, freshness: { state: 'FRESH', dataAsOf: candles.at(-1)?.openedAt ?? requestedAt, ageMs: 0, maximumAgeMs: 60_000 }, candles, validationWarnings: [] }; };

test('strict legacy expansion and non-expansion classifications are preserved', async () => {
  const expanded = await new VolumeExpansionDetector().execute(snapshot([candle(0, 100), candle(1, 116)])); assert.equal(expanded.payload?.classification, 'EXPANDED'); assert.equal(expanded.payload?.expansionDetected, true); assert.equal(expanded.payload?.thresholdVolume, 114.99999999999999); assert.equal(expanded.payload?.volumeIncrease, 16); assert.equal(expanded.payload?.volumeRatio, 1.16); assert.equal(expanded.payload?.volumeChangePercent, 16);
  const unchanged = await new VolumeExpansionDetector().execute(snapshot([candle(0, 100), candle(1, 110)])); assert.equal(unchanged.payload?.classification, 'NOT_EXPANDED'); assert.equal(unchanged.payload?.expansionDetected, false);
});

test('exact multiplier equality does not qualify', async () => { const previous = 200, current = previous * 1.15; const result = await new VolumeExpansionDetector().execute(snapshot([candle(0, previous), candle(1, current)])); assert.equal(result.payload?.thresholdVolume, current); assert.equal(result.payload?.expansionDetected, false); });

test('unavailable volume preserves the legacy false boolean without unsafe numbers', async () => {
  for (const values of [[null, 120], [100, null], [null, null]] as const) { const result = await new VolumeExpansionDetector().execute(snapshot([candle(0, values[0]), candle(1, values[1])])); assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.classification, 'NOT_EXPANDED'); assert.equal(result.payload?.expansionDetected, false); assert.equal(result.payload?.volumeAvailable, false); assert.ok(result.warnings.length); assert.doesNotMatch(JSON.stringify(result), /Infinity|NaN/); }
});

test('zero previous volume is replay-safe and ratios remain null', async () => { const result = await new VolumeExpansionDetector().execute(snapshot([candle(0, 0), candle(1, 1)])); assert.equal(result.payload?.expansionDetected, true); assert.equal(result.payload?.volumeRatio, null); assert.equal(result.payload?.volumeChangePercent, null); });

test('latest two completed candles are used and incomplete latest is excluded', async () => { const values = [candle(0, 10), candle(1, 100), candle(2, 116)]; let result = await new VolumeExpansionDetector().execute(snapshot(values)); assert.equal(result.payload?.previousVolume, 100); assert.equal(result.payload?.currentVolume, 116); const incomplete = { ...candle(3, 1000), complete: false, closedAt: new Date(base + 5 * 3_600_000).toISOString() }; result = await new VolumeExpansionDetector().execute(snapshot([...values, incomplete])); assert.equal(result.payload?.currentVolume, 116); assert.equal(result.payload?.eventCandleTime, values[2].openedAt); });

test('insufficient history and malformed candles have explicit semantics', async () => { assert.equal((await new VolumeExpansionDetector().execute(snapshot([candle(0, 100)]))).status, 'INSUFFICIENT_DATA'); const invalid = [candle(0, 100), candle(1, 120)]; invalid[0].high = Number.NaN; const error = await new VolumeExpansionDetector().execute(snapshot(invalid)); assert.equal(error.status, 'ERROR'); assert.equal(error.errorCode, 'INVALID_OHLC'); });

test('metadata, registry, runner, context, JSON, shadow parity, and immutability integrate', async () => {
  const detector = new VolumeExpansionDetector(); assert.deepEqual({ id: detector.id, version: detector.version, displayName: detector.displayName, deterministic: detector.deterministic, supportsReplay: detector.metadata.supportsReplay, experimental: detector.metadata.experimental, enabledByDefault: detector.metadata.enabledByDefault }, { id: 'volume-expansion', version: '1.0.0', displayName: 'Volume Expansion Detector', deterministic: true, supportsReplay: true, experimental: true, enabledByDefault: true }); assert.ok(createDetectorRegistry().exists('volume-expansion'));
  const source = snapshot([candle(0, 100), candle(1, 116)]), before = JSON.stringify(source), runner = new DetectorRunner(new DetectorRegistry().register(detector).freeze(), { createRunId: () => 'volume-run' }), summary = await runner.execute(source, ['volume-expansion']), context = new AnalysisContextBuilder({ now: () => source.requestedAt }).build(source, summary), beforeContext = JSON.stringify(context), report = new ShadowValidator().validate(source, context), comparison = report.comparisons.find((item) => item.detectorId === 'volume-expansion'); assert.equal(comparison?.status, 'MATCH'); assert.equal(comparison?.exactMatch, true); assert.equal(JSON.stringify(source), before); assert.equal(JSON.stringify(context), beforeContext); assert.deepEqual(JSON.parse(JSON.stringify(context)), context); assert.doesNotMatch(JSON.stringify(summary.detectorResults[0]), /BUY|SELL|strategy|risk|readiness|entry|stopLoss|takeProfit|target|decision/i);
});

test('deliberately incorrect inclusive threshold produces shadow MISMATCH', async () => { const previous = 200, source = snapshot([candle(0, previous), candle(1, previous * 1.15)]), detector = new VolumeExpansionDetector(), summary = await new DetectorRunner(new DetectorRegistry().register(detector).freeze()).execute(source, ['volume-expansion']), context = new AnalysisContextBuilder({ now: () => source.requestedAt }).build(source, summary), wrong = context.detectorResults.map((result): DetectorResult => ({ ...result, payload: { ...(result.payload as object), classification: 'EXPANDED', expansionDetected: true } })), comparison = new ShadowValidator().validate(source, { ...context, detectorResults: wrong }).comparisons.find((item) => item.detectorId === 'volume-expansion'); assert.equal(comparison?.status, 'MISMATCH'); });
