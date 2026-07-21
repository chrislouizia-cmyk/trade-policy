import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import type { DetectorResult, MarketDataSnapshot, NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { RejectionCandleDetector } from '../lib/market-intelligence/detectors/rejection-candle/rejection-candle-detector.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRegistry } from '../lib/market-intelligence/registry/detector-registry.ts';
import { DetectorRunner } from '../lib/market-intelligence/runner/detector-runner.ts';
import { ShadowValidator } from '../lib/market-intelligence/shadow-validation/shadow-validator.ts';

const base = Date.parse('2026-05-01T00:00:00.000Z');
const candle = (index: number, open: number, high: number, low: number, close: number): NormalizedCandle => ({ openedAt: new Date(base + index * 3_600_000).toISOString(), closedAt: new Date(base + (index + 1) * 3_600_000).toISOString(), open, high, low, close, volume: 100, complete: true });
const snapshot = (candles: NormalizedCandle[], timeframe = 'H1'): MarketDataSnapshot => { const requestedAt = new Date(base + Math.max(1, candles.length) * 3_600_000).toISOString(); return { id: `rejection-${timeframe}`, snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe, requestedAt, receivedAt: requestedAt, dataAsOf: candles.at(-1)?.openedAt ?? requestedAt, freshness: { state: 'FRESH', dataAsOf: candles.at(-1)?.openedAt ?? requestedAt, ageMs: 0, maximumAgeMs: 60_000 }, candles, validationWarnings: [] }; };

test('upper, lower, both, and no rejection preserve exact legacy classification', async () => {
  const fixtures = [
    [candle(0, 100, 105.1, 100, 102), 'UPPER', true, false],
    [candle(0, 100, 102, 96.9, 102), 'LOWER', false, true],
    [candle(0, 100, 105.1, 96.9, 102), 'BOTH', true, true],
    [candle(0, 100, 104, 99, 102), 'NONE', false, false],
  ] as const;
  for (const [value, classification, upper, lower] of fixtures) { const result = await new RejectionCandleDetector().execute(snapshot([value])); assert.equal(result.status, 'DETECTED'); assert.equal(result.payload?.classification, classification); assert.equal(result.payload?.rejectionDetected, upper || lower); assert.equal(result.payload?.upperRejection, upper); assert.equal(result.payload?.lowerRejection, lower); }
});

test('strict upper and lower equality do not qualify', async () => {
  const upper = await new RejectionCandleDetector().execute(snapshot([candle(0, 100, 105, 100, 102)])); const lower = await new RejectionCandleDetector().execute(snapshot([candle(0, 100, 102, 97, 102)]));
  assert.equal(upper.payload?.upperWick, 3); assert.equal(upper.payload?.classification, 'NONE'); assert.equal(lower.payload?.lowerWick, 3); assert.equal(lower.payload?.classification, 'NONE');
});

test('zero-body candles preserve legacy booleans while unsafe ratios are null', async () => {
  const fixtures = [[candle(0, 100, 101, 100, 100), 'UPPER'], [candle(0, 100, 100, 99, 100), 'LOWER'], [candle(0, 100, 101, 99, 100), 'BOTH'], [candle(0, 100, 100, 100, 100), 'NONE']] as const;
  for (const [value, classification] of fixtures) { const result = await new RejectionCandleDetector().execute(snapshot([value])); assert.equal(result.payload?.classification, classification); assert.equal(result.payload?.upperWickToBodyRatio, null); assert.equal(result.payload?.lowerWickToBodyRatio, null); assert.doesNotMatch(JSON.stringify(result), /Infinity|NaN/); }
});

test('anatomy fields are descriptive and exact', async () => {
  const result = await new RejectionCandleDetector().execute(snapshot([candle(0, 100, 106, 97, 102)])); assert.deepEqual({ bodySize: result.payload?.bodySize, fullRange: result.payload?.fullRange, upperWick: result.payload?.upperWick, lowerWick: result.payload?.lowerWick, bodyToRangeRatio: result.payload?.bodyToRangeRatio, upperWickToBodyRatio: result.payload?.upperWickToBodyRatio, lowerWickToBodyRatio: result.payload?.lowerWickToBodyRatio }, { bodySize: 2, fullRange: 9, upperWick: 4, lowerWick: 3, bodyToRangeRatio: 2 / 9, upperWickToBodyRatio: 2, lowerWickToBodyRatio: 1.5 });
});

test('latest completed candle is selected and an incomplete latest candle is excluded', async () => {
  const first = candle(0, 100, 101, 100, 100), second = candle(1, 100, 100, 99, 100); let result = await new RejectionCandleDetector().execute(snapshot([first, second])); assert.equal(result.payload?.classification, 'LOWER'); assert.equal(result.payload?.eventCandleTime, second.openedAt);
  const incomplete = { ...candle(2, 100, 105, 100, 102), complete: false, closedAt: new Date(base + 4 * 3_600_000).toISOString() }; result = await new RejectionCandleDetector().execute(snapshot([first, second, incomplete])); assert.equal(result.payload?.classification, 'LOWER'); assert.equal(result.payload?.eventCandleTime, second.openedAt);
});

test('missing completed candles return INSUFFICIENT_DATA', async () => { const result = await new RejectionCandleDetector().execute(snapshot([])); assert.equal(result.status, 'INSUFFICIENT_DATA'); assert.equal(result.payload, null); });

test('malformed OHLC, impossible geometry, timestamps, and ordering return ERROR', async () => {
  const fixtures: Array<[NormalizedCandle[], string]> = []; const nan = candle(0, 100, 105, 95, 101); nan.open = Number.NaN; fixtures.push([[nan], 'INVALID_OHLC']); fixtures.push([[candle(0, 100, 99, 95, 101)], 'IMPOSSIBLE_CANDLE_GEOMETRY']); const invalid = candle(0, 100, 105, 95, 101); invalid.closedAt = 'bad'; fixtures.push([[invalid], 'INVALID_TIMESTAMP']); const duplicate = [candle(0, 100, 105, 95, 101), candle(0, 100, 105, 95, 101)]; fixtures.push([duplicate, 'INVALID_CANDLE_ORDER']);
  for (const [values, code] of fixtures) { const result = await new RejectionCandleDetector().execute(snapshot(values)); assert.equal(result.status, 'ERROR'); assert.equal(result.errorCode, code); }
});

test('metadata, registry, runner, ContextBuilder, shadow parity, and immutability integrate', async () => {
  const detector = new RejectionCandleDetector(); assert.deepEqual({ id: detector.id, version: detector.version, displayName: detector.displayName, deterministic: detector.deterministic, supportsReplay: detector.metadata.supportsReplay, experimental: detector.metadata.experimental, enabledByDefault: detector.metadata.enabledByDefault }, { id: 'rejection-candle', version: '1.0.0', displayName: 'Rejection Candle Detector', deterministic: true, supportsReplay: true, experimental: true, enabledByDefault: true }); assert.ok(createDetectorRegistry().exists('rejection-candle'));
  const source = snapshot([candle(0, 100, 105.1, 100, 102)]), before = JSON.stringify(source); const summary = await new DetectorRunner(new DetectorRegistry().register(detector).freeze(), { createRunId: () => 'rejection-run' }).execute(source, ['rejection-candle']); const context = new AnalysisContextBuilder({ now: () => source.requestedAt }).build(source, summary), beforeContext = JSON.stringify(context); const report = new ShadowValidator().validate(source, context), comparison = report.comparisons.find((item) => item.detectorId === 'rejection-candle'); assert.equal(comparison?.status, 'MATCH'); assert.equal(comparison?.exactMatch, true); assert.equal(JSON.stringify(source), before); assert.equal(JSON.stringify(context), beforeContext); assert.deepEqual(JSON.parse(JSON.stringify(summary.detectorResults[0])), summary.detectorResults[0]); assert.doesNotMatch(JSON.stringify(summary.detectorResults[0]), /BUY|SELL|strategy|risk|readiness|entry|stopLoss|takeProfit|target|decision/i);
});

test('a deliberately wrong wick threshold result produces a shadow mismatch', async () => {
  const source = snapshot([candle(0, 100, 104, 100, 102)]), detector = new RejectionCandleDetector(), runner = new DetectorRunner(new DetectorRegistry().register(detector).freeze()); const summary = await runner.execute(source, ['rejection-candle']); const context = new AnalysisContextBuilder({ now: () => source.requestedAt }).build(source, summary); const wrong = context.detectorResults.map((result): DetectorResult => ({ ...result, payload: { ...(result.payload as object), classification: 'UPPER', rejectionDetected: true, upperRejection: true } })); const comparison = new ShadowValidator().validate(source, { ...context, detectorResults: wrong }).comparisons.find((item) => item.detectorId === 'rejection-candle'); assert.equal(comparison?.status, 'MISMATCH'); assert.ok(comparison?.mismatchReasons.some((reason) => reason.includes('classification') || reason.includes('upperRejection')));
});
