import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import type { DetectorResult, MarketDataSnapshot } from '../lib/market-intelligence/contracts.ts';
import type { DetectorRunSummary } from '../lib/market-intelligence/types/detector.ts';
import { METHODOLOGY_LIBRARY } from '../lib/strategy-builder-v2.ts';

const now = '2026-01-01T00:00:00.000Z'; const fresh = { state: 'FRESH' as const, dataAsOf: now, ageMs: 0, maximumAgeMs: 1 };
const snapshot: MarketDataSnapshot = { id: 's', snapshotVersion: '1', provider: 'fixture', providerVersion: '1', providerSymbol: 'XAUUSD', instrument: 'XAUUSD', timeframe: 'M5', requestedAt: now, receivedAt: now, dataAsOf: now, freshness: fresh, candles: [], validationWarnings: [] };
const block = (id: string, timeframe: string, status: 'ACTIVE' | 'PARTIALLY_MITIGATED' | 'MITIGATED' | 'INVALIDATED', eligible: boolean) => ({ id, direction: 'BULLISH' as const, timeframe, sourceCandleTime: now, confirmationTime: now, zoneLow: 1, zoneHigh: 2, status, eligible });
const result = (timeframe: string, blocks: ReturnType<typeof block>[]): DetectorResult => ({ detectorId: 'order-block', detectorVersion: '1', runId: 'r', instrument: 'XAUUSD', timeframe, observedAt: now, dataAsOf: now, status: 'DETECTED', confidence: 1, payload: { orderBlocks: blocks, selected: blocks.find(item => item.eligible) ?? null }, evidence: blocks.map(item => ({ id: item.id, type: 'CANDLE_PATTERN', description: 'Order Block' })), freshness: fresh, warnings: [] });
const context = (results: DetectorResult[]) => new AnalysisContextBuilder({ now: () => now }).build(snapshot, { runId: 'r', startedAt: now, completedAt: now, durationMs: 0, detectorResults: results, detectorFailures: [], successfulCount: results.length, failedCount: 0 } as DetectorRunSummary);

test('ContextBuilder preserves full lifecycle observations and deterministic selected block per timeframe', () => {
  const value = context([result('M5', [block('active', 'M5', 'ACTIVE', true), block('terminal', 'M5', 'MITIGATED', false)])]);
  assert.deepEqual(value.orderBlocksByTimeframe?.M5.blocks.map(item => [item.id, item.status, item.eligible, item.evidenceId]), [['active', 'ACTIVE', true, 'active'], ['terminal', 'MITIGATED', false, 'terminal']]);
  assert.equal(value.orderBlocksByTimeframe?.M5.selected?.id, 'active');
});

test('Order Block context is isolated by timeframe and never changes its MANUAL Trading DNA capability', () => {
  const value = context([result('M5', [block('m5', 'M5', 'PARTIALLY_MITIGATED', true)]), result('H1', [block('h1', 'H1', 'INVALIDATED', false)])]);
  assert.equal(value.orderBlocksByTimeframe?.M5.selected?.id, 'm5'); assert.equal(value.orderBlocksByTimeframe?.H1.selected, null);
  assert.equal(METHODOLOGY_LIBRARY.find(item => item.id === 'smc')?.rules.find(rule => rule.key === 'order-block')?.capability, 'MANUAL');
  assert.equal('decision' in (value.orderBlocksByTimeframe?.M5 ?? {}), false);
});
