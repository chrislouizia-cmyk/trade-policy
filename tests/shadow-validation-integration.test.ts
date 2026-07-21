import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import { AnalysisOrchestrator } from '../lib/market-intelligence/analysis/analysis-orchestrator.ts';
import type { MarketDataSnapshot, NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRunner } from '../lib/market-intelligence/runner/detector-runner.ts';
import { createLegacyComparableObservations, ShadowValidator } from '../lib/market-intelligence/shadow-validation/index.ts';

const base = Date.parse('2026-03-01T00:00:00Z');
const candles: NormalizedCandle[] = Array.from({ length: 30 }, (_, index) => ({ openedAt: new Date(base + index * 60_000).toISOString(), closedAt: new Date(base + (index + 1) * 60_000).toISOString(), open: 100 + index, high: 102 + index, low: 98 + index, close: 100 + index, volume: 10, complete: true }));
const requestedAt = new Date(base + 31 * 60_000).toISOString();
const snapshot: MarketDataSnapshot = { id: 'shared-snapshot', snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe: 'M1', requestedAt, receivedAt: requestedAt, dataAsOf: candles.at(-1)!.openedAt, freshness: { state: 'FRESH', dataAsOf: candles.at(-1)!.openedAt, ageMs: 0, maximumAgeMs: 60_000 }, candles, validationWarnings: [] };

test('one shared immutable snapshot drives one pipeline run and one legacy execution', async () => {
  let gatewayCalls = 0, adapterCalls = 0;
  const orchestrator = new AnalysisOrchestrator({ async fetchSnapshot() { gatewayCalls++; return snapshot; } }, new DetectorRunner(createDetectorRegistry(), { createRunId: () => 'one-run' }), new AnalysisContextBuilder({ now: () => requestedAt }));
  const context = await orchestrator.analyze({ providerId: 'fixture', detectorIds: ['atr', 'trend', 'range-levels', 'break-of-structure', 'liquidity-sweep', 'fair-value-gap', 'rejection-candle', 'volume-expansion', 'displacement', 'volatility-requirement', 'retest'], marketDataRequest: { instrument: 'XAUUSD', timeframe: 'M1', candleCount: 30, includeCurrentPrice: false, includeSpread: false, allowCached: true, maximumDataAge: 60_000, requestedAt } });
  const beforeContext = JSON.stringify(context), beforeCandles = JSON.stringify(snapshot.candles);
  const report = new ShadowValidator({ legacyAdapter(value) { adapterCalls++; assert.equal(value, snapshot); return createLegacyComparableObservations(value); } }).validate(snapshot, context);
  assert.equal(gatewayCalls, 1); assert.equal(adapterCalls, 1); assert.equal(report.comparisons.length, 11); assert.equal(report.summary.matches, 11); assert.equal(report.summary.matchRate, 1);
  assert.equal(JSON.stringify(context), beforeContext); assert.equal(JSON.stringify(snapshot.candles), beforeCandles); assert.doesNotMatch(JSON.stringify(report), /BUY|SELL|strategy|risk|readiness|authorization|tradeCandidate/i);
});

test('snapshot identity mismatch invalidates every comparison', async () => {
  const summary = await new DetectorRunner(createDetectorRegistry()).execute(snapshot, ['atr', 'trend', 'range-levels', 'break-of-structure', 'liquidity-sweep', 'fair-value-gap', 'rejection-candle', 'volume-expansion', 'displacement', 'volatility-requirement', 'retest']); const context = new AnalysisContextBuilder({ now: () => requestedAt }).build(snapshot, summary);
  const report = new ShadowValidator().validate({ ...snapshot, id: 'different-snapshot' }, context); assert.ok(report.comparisons.every((item) => item.status === 'ERROR')); assert.equal(report.summary.errors, 11);
});
