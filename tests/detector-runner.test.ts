import assert from 'node:assert/strict';
import test from 'node:test';
import type { DetectorResult, MarketDataSnapshot } from '../lib/market-intelligence/contracts.ts';
import { PlaceholderDetector } from '../lib/market-intelligence/detectors/placeholder-detector.ts';
import { DetectorRegistry } from '../lib/market-intelligence/registry/detector-registry.ts';
import { DetectorRunner } from '../lib/market-intelligence/runner/detector-runner.ts';
import type { MarketDetector } from '../lib/market-intelligence/types/detector.ts';

const timestamp = '2026-07-21T12:00:00.000Z';
const snapshot: MarketDataSnapshot = {
  id: 'snapshot-1', snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1.0.0', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe: 'H1',
  requestedAt: timestamp, receivedAt: timestamp, dataAsOf: timestamp,
  freshness: { state: 'FRESH', dataAsOf: timestamp, ageMs: 0, maximumAgeMs: 60_000 }, candles: [], validationWarnings: [],
};

class FixtureDetector implements MarketDetector {
  readonly metadata;
  readonly id: string;
  private readonly behavior: 'PASS' | 'THROW';
  private readonly delayMs: number;
  constructor(id: string, behavior: 'PASS' | 'THROW', delayMs = 0) {
    this.id = id;
    this.behavior = behavior;
    this.delayMs = delayMs;
    this.metadata = { id, version: '1.2.3', displayName: id, deterministic: true, supportedTimeframes: ['H1'], supportsReplay: true, experimental: false, enabledByDefault: true, description: 'Test fixture.' };
  }
  get version() { return this.metadata.version; }
  get displayName() { return this.metadata.displayName; }
  get deterministic() { return this.metadata.deterministic; }
  get supportedTimeframes(): readonly string[] { return this.metadata.supportedTimeframes; }
  async execute(value: MarketDataSnapshot): Promise<DetectorResult> {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.behavior === 'THROW') throw new Error(`${this.id} failed`);
    return { detectorId: this.id, detectorVersion: this.version, runId: 'detector-local', instrument: value.instrument, timeframe: value.timeframe, observedAt: timestamp, dataAsOf: value.dataAsOf, status: 'NOT_DETECTED', confidence: 100, payload: {}, evidence: [], freshness: value.freshness, warnings: [] };
  }
}

test('placeholder detector returns infrastructure-only INSUFFICIENT_DATA output', async () => {
  const result = await new PlaceholderDetector().execute(snapshot);
  assert.equal(result.status, 'INSUFFICIENT_DATA');
  assert.equal(result.confidence, null);
  assert.equal(result.payload, null);
  assert.deepEqual(result.warnings, ['Placeholder detector']);
});

test('runner executes registered detectors and returns a complete timed summary', async () => {
  const times = [1_000, 1_025];
  const registry = new DetectorRegistry().register(new PlaceholderDetector()).freeze();
  const summary = await new DetectorRunner(registry, { now: () => times.shift()!, createRunId: () => 'run-1' }).execute(snapshot, ['infrastructure.placeholder']);
  assert.equal(summary.runId, 'run-1');
  assert.equal(summary.durationMs, 25);
  assert.equal(summary.startedAt, new Date(1_000).toISOString());
  assert.equal(summary.completedAt, new Date(1_025).toISOString());
  assert.equal(summary.detectorResults[0].runId, 'run-1');
  assert.equal(summary.successfulCount, 1);
  assert.equal(summary.failedCount, 0);
  assert.deepEqual(summary.detectorFailures, []);
});

test('runner uses all-settled isolation so one failure does not stop another detector', async () => {
  const registry = new DetectorRegistry()
    .register(new FixtureDetector('slow-success', 'PASS', 30))
    .register(new FixtureDetector('fast-failure', 'THROW', 1))
    .freeze();
  const started = Date.now();
  const summary = await new DetectorRunner(registry, { createRunId: () => 'parallel-run' }).execute(snapshot, ['slow-success', 'fast-failure']);
  assert.ok(Date.now() - started < 100, 'detectors should execute concurrently');
  assert.equal(summary.detectorResults.length, 2);
  assert.equal(summary.detectorResults.find((result) => result.detectorId === 'slow-success')?.status, 'NOT_DETECTED');
  assert.equal(summary.detectorResults.find((result) => result.detectorId === 'fast-failure')?.status, 'ERROR');
  assert.equal(summary.successfulCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.deepEqual(summary.detectorFailures.map((failure) => failure.detectorId), ['fast-failure']);
});

test('unknown detectors become explicit ERROR results without rejecting the run', async () => {
  const registry = new DetectorRegistry().register(new FixtureDetector('available', 'PASS')).freeze();
  const summary = await new DetectorRunner(registry).execute(snapshot, ['missing', 'available']);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.successfulCount, 1);
  assert.equal(summary.detectorResults[0].errorCode, 'DETECTOR_NOT_REGISTERED');
  assert.match(summary.detectorFailures[0].message, /not registered/);
});
