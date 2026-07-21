import assert from 'node:assert/strict';
import test from 'node:test';
import type { MarketContext, MarketDataSnapshot } from '../lib/market-intelligence/contracts.ts';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import { AnalysisOrchestrationError } from '../lib/market-intelligence/analysis/analysis-errors.ts';
import { AnalysisOrchestrator } from '../lib/market-intelligence/analysis/analysis-orchestrator.ts';
import type { MarketDataRequest } from '../lib/market-intelligence/providers/market-data-provider.ts';
import type { DetectorRunSummary } from '../lib/market-intelligence/types/detector.ts';

const timestamp = '2026-07-21T12:00:00.000Z';
const request: MarketDataRequest = { instrument: 'XAUUSD', timeframe: 'H1', candleCount: 100, includeCurrentPrice: true, includeSpread: true, allowCached: true, maximumDataAge: 60_000, requestedAt: timestamp };
const freshness = { state: 'FRESH' as const, dataAsOf: timestamp, ageMs: 0, maximumAgeMs: 60_000 };
const snapshot: MarketDataSnapshot = { id: 'snapshot-1', snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1.0.0', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe: 'H1', requestedAt: timestamp, receivedAt: timestamp, dataAsOf: timestamp, freshness, candles: [], validationWarnings: [] };
const summary: DetectorRunSummary = { runId: 'run-1', startedAt: timestamp, completedAt: timestamp, durationMs: 0, detectorResults: [], detectorFailures: [], successfulCount: 0, failedCount: 0 };
const expected = new AnalysisContextBuilder({ now: () => timestamp }).build(snapshot, summary);

test('orchestrator calls gateway, runner, and builder exactly once in order', async () => {
  const calls: string[] = [];
  let gatewayCount = 0; let runnerCount = 0; let builderCount = 0;
  const orchestrator = new AnalysisOrchestrator(
    { async fetchSnapshot(providerId, value) { gatewayCount++; calls.push('gateway'); assert.equal(providerId, 'fixture'); assert.equal(value, request); return snapshot; } },
    { async execute(value, detectorIds) { runnerCount++; calls.push('runner'); assert.equal(value, snapshot); assert.deepEqual(detectorIds, ['trend']); return summary; } },
    { build(value, run) { builderCount++; calls.push('builder'); assert.equal(value, snapshot); assert.equal(run, summary); return expected; } },
  );
  assert.equal(await orchestrator.analyze({ marketDataRequest: request, providerId: 'fixture', detectorIds: ['trend'] }), expected);
  assert.deepEqual(calls, ['gateway', 'runner', 'builder']);
  assert.deepEqual([gatewayCount, runnerCount, builderCount], [1, 1, 1]);
});

test('orchestrator supports an empty detector list', async () => {
  const orchestrator = new AnalysisOrchestrator({ async fetchSnapshot() { return snapshot; } }, { async execute(_snapshot, ids) { assert.deepEqual(ids, []); return summary; } }, new AnalysisContextBuilder({ now: () => timestamp }));
  const context = await orchestrator.analyze({ marketDataRequest: request, providerId: 'fixture', detectorIds: [] });
  assert.deepEqual(context.detectorResults, []);
});

test('orchestrator preserves failed detector summaries for context generation', async () => {
  const failed = { ...summary, failedCount: 1, detectorFailures: [{ detectorId: 'missing', errorCode: 'DETECTOR_NOT_REGISTERED', message: 'Detector is not registered: missing' }] };
  const orchestrator = new AnalysisOrchestrator({ async fetchSnapshot() { return snapshot; } }, { async execute() { return failed; } }, new AnalysisContextBuilder({ now: () => timestamp }));
  const context = await orchestrator.analyze({ marketDataRequest: request, providerId: 'fixture', detectorIds: ['missing'] });
  assert.equal(context.conflicts[0].type, 'MISSING_REQUIRED_DETECTOR');
});

test('unknown providers become stable market-data-stage errors', async () => {
  const providerError = Object.assign(new Error('Market-data provider is not registered: missing'), { code: 'PROVIDER_NOT_REGISTERED' });
  const orchestrator = new AnalysisOrchestrator({ async fetchSnapshot() { throw providerError; } }, { async execute() { return summary; } }, { build() { return expected as MarketContext; } });
  await assert.rejects(
    () => orchestrator.analyze({ marketDataRequest: request, providerId: 'missing', detectorIds: [] }),
    (error: unknown) => error instanceof AnalysisOrchestrationError && error.stage === 'MARKET_DATA' && error.code === 'PROVIDER_NOT_REGISTERED',
  );
});
