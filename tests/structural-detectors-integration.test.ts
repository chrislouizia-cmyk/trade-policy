import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import { AnalysisOrchestrator } from '../lib/market-intelligence/analysis/analysis-orchestrator.ts';
import type { BreakOfStructureObservation, LiquiditySweepObservation, MarketDataSnapshot, NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { BreakOfStructureDetector } from '../lib/market-intelligence/detectors/break-of-structure/break-of-structure-detector.ts';
import { LiquiditySweepDetector } from '../lib/market-intelligence/detectors/liquidity-sweep/liquidity-sweep-detector.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRegistry } from '../lib/market-intelligence/registry/detector-registry.ts';
import { DetectorRunner } from '../lib/market-intelligence/runner/detector-runner.ts';

const base = Date.parse('2026-01-15T00:00:00.000Z');
const candle = (index: number, high = 110, low = 90, close = 100): NormalizedCandle => ({ openedAt: new Date(base + index * 3_600_000).toISOString(), closedAt: new Date(base + (index + 1) * 3_600_000).toISOString(), open: 100, high, low, close, volume: 100, complete: true });
function snapshot(timeframe = 'H1', event = candle(19, 111, 89, 100)): MarketDataSnapshot { const values = [...Array.from({ length: 19 }, (_, index) => candle(index)), event]; const requestedAt = new Date(base + 20 * 3_600_000).toISOString(); return { id: `snapshot-${timeframe}`, snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1.0.0', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe, requestedAt, receivedAt: requestedAt, dataAsOf: event.openedAt, freshness: { state: 'FRESH', dataAsOf: event.openedAt, ageMs: 0, maximumAgeMs: 60_000 }, candles: values, validationWarnings: ['fixture warning'] }; }

test('both detectors are registered and execute independently in the same run', async () => {
  const bootstrapped = createDetectorRegistry(); assert.ok(bootstrapped.exists('break-of-structure')); assert.ok(bootstrapped.exists('liquidity-sweep'));
  const registry = new DetectorRegistry().register(new BreakOfStructureDetector()).register(new LiquiditySweepDetector()).freeze(); const summary = await new DetectorRunner(registry, { createRunId: () => 'structural-run' }).execute(snapshot(), ['break-of-structure', 'liquidity-sweep']);
  assert.equal(summary.detectorResults.length, 2); assert.equal(summary.failedCount, 0); assert.equal((summary.detectorResults[0].payload as BreakOfStructureObservation).direction, 'NONE'); assert.equal((summary.detectorResults[1].payload as LiquiditySweepObservation).side, 'BOTH');
});

test('orchestrator fetches gateway data once for both detectors and ContextBuilder preserves outputs only', async () => {
  let gatewayCalls = 0; const marketSnapshot = snapshot(); const registry = new DetectorRegistry().register(new BreakOfStructureDetector()).register(new LiquiditySweepDetector()).freeze(); const runner = new DetectorRunner(registry, { createRunId: () => 'structural-run' }); const builder = new AnalysisContextBuilder({ now: () => '2026-01-15T08:00:00.000Z' });
  const orchestrator = new AnalysisOrchestrator({ async fetchSnapshot() { gatewayCalls++; return marketSnapshot; } }, runner, builder);
  const context = await orchestrator.analyze({ providerId: 'fixture', detectorIds: ['break-of-structure', 'liquidity-sweep'], marketDataRequest: { instrument: 'XAUUSD', timeframe: 'H1', candleCount: 8, includeCurrentPrice: false, includeSpread: false, allowCached: true, maximumDataAge: 60_000, requestedAt: marketSnapshot.requestedAt } });
  assert.equal(gatewayCalls, 1); assert.deepEqual(context.detectorResults.map((result) => result.detectorId), ['break-of-structure', 'liquidity-sweep']); assert.equal(context.detectorResultsByTimeframe.H1.length, 2); assert.deepEqual(context.warnings, ['fixture warning']); assert.deepEqual(context.conflicts, []); assert.ok(context.detectorResults.every((result) => result.evidence[0].metadata?.detectorVersion === '1.0.0')); assert.deepEqual(JSON.parse(JSON.stringify(context)), context);
});

test('multiple timeframe outputs group independently and no operational fields are emitted', async () => {
  const registry = new DetectorRegistry().register(new BreakOfStructureDetector()).register(new LiquiditySweepDetector()).freeze(); const runner = new DetectorRunner(registry);
  const h1 = await runner.execute(snapshot('H1'), ['break-of-structure', 'liquidity-sweep']); const h4 = await runner.execute(snapshot('H4', candle(19, 112, 99, 111)), ['break-of-structure', 'liquidity-sweep']); const combined = { ...h1, detectorResults: [...h1.detectorResults, ...h4.detectorResults], successfulCount: 4 };
  const context = new AnalysisContextBuilder().build(snapshot('H1'), combined); assert.equal(context.detectorResultsByTimeframe.H1.length, 2); assert.equal(context.detectorResultsByTimeframe.H4.length, 2);
  assert.doesNotMatch(JSON.stringify(context.detectorResults), /BUY|SELL|choch|strategy|riskAllowed|readiness|authorization|takeProfit|stopLoss/i);
});

test('insufficient and detector error results survive runner and context aggregation', async () => {
  const registry = new DetectorRegistry().register(new BreakOfStructureDetector()).register(new LiquiditySweepDetector()).freeze(); const runner = new DetectorRunner(registry); const insufficientSnapshot = { ...snapshot(), candles: snapshot().candles.slice(0, 7) }; const invalid = snapshot('M15'); invalid.candles[0] = { ...invalid.candles[0], high: 80 };
  const insufficient = await runner.execute(insufficientSnapshot, ['break-of-structure']); const error = await runner.execute(invalid, ['liquidity-sweep']); const combined = { ...insufficient, detectorResults: [...insufficient.detectorResults, ...error.detectorResults], detectorFailures: error.detectorFailures, failedCount: 1 };
  const context = new AnalysisContextBuilder().build(insufficientSnapshot, combined); assert.equal(context.detectorResults[0].status, 'INSUFFICIENT_DATA'); assert.equal(context.detectorResults[1].status, 'ERROR'); assert.ok(context.conflicts.some((conflict) => conflict.type === 'DETECTOR_FAILURE'));
});
