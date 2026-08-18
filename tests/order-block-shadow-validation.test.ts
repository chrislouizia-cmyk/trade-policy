import assert from 'node:assert/strict';
import test from 'node:test';
import { compareManualOrderBlockShadow } from '../lib/market-intelligence/shadow-validation/order-block-shadow.ts';
import type { MarketContext } from '../lib/market-intelligence/contracts.ts';

const now = '2026-01-01T00:00:00.000Z'; const fresh = { state: 'FRESH' as const, dataAsOf: now, ageMs: 0, maximumAgeMs: 1 };
const context = (state: 'eligible' | 'none' | 'unavailable' = 'eligible'): MarketContext => ({ contextId: 'm', contextVersion: '1', instrument: 'XAUUSD', provider: 'fixture', providerVersion: '1', timeframes: ['M5'], snapshotId: 's', snapshotVersion: '1', snapshotFreshness: fresh, detectorRunId: 'r', detectorResults: [], detectorResultsByTimeframe: {}, ...(state === 'unavailable' ? {} : { orderBlocksByTimeframe: { M5: { blocks: state === 'eligible' ? [{ id: 'ob-1', direction: 'BULLISH', timeframe: 'M5', sourceCandleTime: now, confirmationTime: now, zoneLow: 1, zoneHigh: 2, status: 'ACTIVE', eligible: true, evidenceId: 'ob-1' }] : [], selected: state === 'eligible' ? { id: 'ob-1', direction: 'BULLISH', timeframe: 'M5', sourceCandleTime: now, confirmationTime: now, zoneLow: 1, zoneHigh: 2, status: 'ACTIVE', eligible: true, evidenceId: 'ob-1' } : null } } }), warnings: [], conflicts: [], overallFreshness: 'FRESH', overallConfidence: null, dataAsOf: now, generatedAt: now });
const compare = (state: 'CONFIRMED' | 'FAILED' | 'PENDING', mode: 'eligible' | 'none' | 'unavailable' = 'eligible', timeframe = 'M5') => compareManualOrderBlockShadow({ rulePresent: true, timeframe, manualConfirmation: { evidenceKey: 'orderBlock', state }, marketContext: context(mode) });

test('Order Block shadow comparison remains observational across manual and detector states', () => {
  assert.deepEqual([compare('CONFIRMED')?.agreement, compare('FAILED')?.agreement, compare('PENDING')?.agreement], ['AGREE', 'DISAGREE', 'UNRESOLVED']);
  assert.equal(compare('CONFIRMED', 'none')?.agreement, 'DISAGREE'); assert.equal(compare('PENDING', 'none')?.agreement, 'UNRESOLVED');
  assert.equal(compare('CONFIRMED', 'unavailable')?.detectorState, 'UNAVAILABLE');
});
test('shadow is timeframe-isolated and absent when no Order Block rule exists', () => {
  assert.equal(compare('CONFIRMED', 'eligible', 'M15')?.detectorState, 'NONE');
  assert.equal(compareManualOrderBlockShadow({ rulePresent: false, timeframe: 'M5', marketContext: context() }), null);
});
