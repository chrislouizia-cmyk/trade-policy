import assert from 'node:assert/strict';
import test from 'node:test';
import type { DetectorResult, MarketDataSnapshot } from '../lib/market-intelligence/contracts.ts';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import type { DetectorRunSummary } from '../lib/market-intelligence/types/detector.ts';

const now = '2026-07-21T12:00:00.000Z';
const fresh = { state: 'FRESH' as const, dataAsOf: now, ageMs: 0, maximumAgeMs: 60_000 };
const snapshot: MarketDataSnapshot = {
  id: 'snapshot-1', snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '2.0.0', providerSymbol: 'XAU/USD',
  instrument: 'XAUUSD', timeframe: 'H1', requestedAt: now, receivedAt: now, dataAsOf: now, freshness: fresh,
  candles: [], validationWarnings: ['snapshot warning'],
};

function result(overrides: Partial<DetectorResult> = {}): DetectorResult {
  return {
    detectorId: 'trend', detectorVersion: '1.2.3', runId: 'local', instrument: 'XAUUSD', timeframe: 'H1',
    observedAt: now, dataAsOf: now, status: 'DETECTED', confidence: 80, payload: { bias: 'BULLISH' },
    evidence: [{ id: 'evidence-1', type: 'CANDLE', description: 'fixture' }], freshness: fresh, warnings: ['detector warning'], ...overrides,
  };
}

function summary(detectorResults: DetectorResult[] = [result()], failures: DetectorRunSummary['detectorFailures'] = []): DetectorRunSummary {
  return { runId: 'run-1', startedAt: now, completedAt: now, durationMs: 0, detectorResults, detectorFailures: failures, successfulCount: detectorResults.length - failures.length, failedCount: failures.length };
}

const builder = () => new AnalysisContextBuilder({ now: () => now });

test('context builder creates the complete context envelope and preserves outputs and warnings', () => {
  const detectorResult = result();
  const context = builder().build(snapshot, summary([detectorResult]));
  assert.equal(context.contextId, 'context:snapshot-1:run-1');
  assert.equal(context.providerVersion, '2.0.0');
  assert.deepEqual(context.timeframes, ['H1']);
  assert.equal(context.detectorResults[0], detectorResult);
  assert.equal(context.detectorResultsByTimeframe.H1[0], detectorResult);
  assert.deepEqual(context.warnings, ['snapshot warning', 'detector warning']);
  assert.equal(context.overallFreshness, 'FRESH');
  assert.equal(context.overallConfidence, 80);
  assert.equal(context.generatedAt, now);
});

test('context ids are stable for the same snapshot and detector run and serialize to JSON', () => {
  const one = builder().build(snapshot, summary());
  const two = builder().build(snapshot, summary());
  assert.equal(one.contextId, two.contextId);
  assert.deepEqual(JSON.parse(JSON.stringify(one)), one);
});

test('conflicts and evidence are preserved without resolving timeframe disagreement', () => {
  const results = [result({ timeframe: 'H4', payload: { bias: 'BULLISH' } }), result({ timeframe: 'M15', payload: { bias: 'BEARISH' }, evidence: [{ id: 'evidence-2', type: 'CANDLE', description: 'fixture' }] })];
  const context = builder().build(snapshot, summary(results));
  const conflict = context.conflicts.find((item) => item.type === 'TIMEFRAME_DISAGREEMENT');
  assert.deepEqual(context.detectorResults.map((item) => item.payload), [{ bias: 'BULLISH' }, { bias: 'BEARISH' }]);
  assert.deepEqual(conflict?.timeframes, ['H4', 'M15']);
  assert.deepEqual(conflict?.evidenceIds, ['evidence-1', 'evidence-2']);
});

test('freshness aggregation gives stale precedence, then unknown, and records stale snapshot conflict', () => {
  const staleSnapshot = { ...snapshot, freshness: { ...fresh, state: 'STALE' as const } };
  const staleContext = builder().build(staleSnapshot, summary());
  assert.equal(staleContext.overallFreshness, 'STALE');
  assert.ok(staleContext.conflicts.some((item) => item.type === 'STALE_DATA'));
  const unknownContext = builder().build(snapshot, summary([result({ freshness: { ...fresh, state: 'UNKNOWN' } })]));
  assert.equal(unknownContext.overallFreshness, 'UNKNOWN');
});

test('failed and unknown detectors remain explicit conflicts and warnings', () => {
  const failures = [
    { detectorId: 'broken', errorCode: 'DETECTOR_EXECUTION_FAILED', message: 'broken detector' },
    { detectorId: 'missing', errorCode: 'DETECTOR_NOT_REGISTERED', message: 'missing detector' },
  ];
  const context = builder().build(snapshot, summary([
    result({ detectorId: 'broken', status: 'ERROR', payload: null, confidence: null, warnings: ['broken detector'] }),
    result({ detectorId: 'missing', status: 'ERROR', payload: null, confidence: null, warnings: ['missing detector'] }),
  ], failures));
  assert.ok(context.conflicts.some((item) => item.type === 'DETECTOR_FAILURE'));
  assert.ok(context.conflicts.some((item) => item.type === 'MISSING_REQUIRED_DETECTOR'));
  assert.ok(context.warnings.includes('missing detector'));
});

test('empty detector runs produce a valid snapshot-only context', () => {
  const context = builder().build(snapshot, summary([]));
  assert.deepEqual(context.detectorResults, []);
  assert.deepEqual(context.detectorResultsByTimeframe, {});
  assert.deepEqual(context.timeframes, ['H1']);
  assert.equal(context.overallFreshness, 'FRESH');
  assert.equal(context.overallConfidence, null);
});
