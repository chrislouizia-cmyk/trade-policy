import { stableFingerprint } from '../serialization/stable-fingerprint.ts';
import type { OrderBlockShadowResult } from './order-block-shadow.ts';

export type OrderBlockShadowMetricEvent = Readonly<{ eventId: string; instrument: string; timeframe: string; strategyId?: string; strategyRevision?: string; decisionTimestamp: string; comparison: OrderBlockShadowResult }>;
export type OrderBlockShadowMetrics = Readonly<{ agreePass: number; agreeFail: number; disagreeManualPassDetectorNone: number; disagreeManualFailDetectorEligible: number; unresolvedManualPending: number; unresolvedDetectorUnavailable: number; totalComparisons: number; totalResolvedComparisons: number; totalAgreements: number; totalDisagreements: number; agreementRate: number | null; disagreementRate: number | null }>;
export function createOrderBlockShadowMetricEvent(input: Omit<OrderBlockShadowMetricEvent, 'eventId'> & { ownerScope?: string; decisionSourceId?: string }): OrderBlockShadowMetricEvent {
  const { ownerScope, decisionSourceId, ...event } = input;
  return Object.freeze({ ...event, eventId: `order-block-shadow:${stableFingerprint({ ownerScope: ownerScope ?? null, decisionSourceId: decisionSourceId ?? null, strategyId: event.strategyId ?? null, strategyRevision: event.strategyRevision ?? null, instrument: event.instrument, timeframe: event.timeframe, decisionTimestamp: event.decisionTimestamp, manualState: event.comparison.manualState, detectorState: event.comparison.detectorState, selectedBlockId: event.comparison.selectedBlockId ?? null })}` });
}
export function aggregateOrderBlockShadowMetrics(events: readonly OrderBlockShadowMetricEvent[]): OrderBlockShadowMetrics {
  const unique = [...new Map(events.map(event => [event.eventId, event])).values()];
  let agreePass=0, agreeFail=0, disagreeManualPassDetectorNone=0, disagreeManualFailDetectorEligible=0, unresolvedManualPending=0, unresolvedDetectorUnavailable=0;
  for (const { comparison } of unique) {
    if (comparison.manualState === 'PENDING') unresolvedManualPending += 1;
    if (comparison.detectorState === 'UNAVAILABLE') unresolvedDetectorUnavailable += 1;
    if (comparison.manualState === 'PASS' && comparison.detectorState === 'ELIGIBLE') agreePass += 1;
    if (comparison.manualState === 'FAIL' && comparison.detectorState === 'NONE') agreeFail += 1;
    if (comparison.manualState === 'PASS' && comparison.detectorState === 'NONE') disagreeManualPassDetectorNone += 1;
    if (comparison.manualState === 'FAIL' && comparison.detectorState === 'ELIGIBLE') disagreeManualFailDetectorEligible += 1;
  }
  const totalAgreements=agreePass+agreeFail,totalDisagreements=disagreeManualPassDetectorNone+disagreeManualFailDetectorEligible,totalResolvedComparisons=totalAgreements+totalDisagreements;
  return Object.freeze({ agreePass, agreeFail, disagreeManualPassDetectorNone, disagreeManualFailDetectorEligible, unresolvedManualPending, unresolvedDetectorUnavailable, totalComparisons: unique.length, totalResolvedComparisons, totalAgreements, totalDisagreements, agreementRate: totalResolvedComparisons ? totalAgreements / totalResolvedComparisons : null, disagreementRate: totalResolvedComparisons ? totalDisagreements / totalResolvedComparisons : null });
}
export function segmentOrderBlockShadowMetrics(events: readonly OrderBlockShadowMetricEvent[], key: 'instrument' | 'timeframe' | 'strategyId' | 'strategyRevision'): Record<string, OrderBlockShadowMetrics> { const groups = new Map<string, OrderBlockShadowMetricEvent[]>(); for (const event of events) { const value = event[key]; if (!value) continue; groups.set(value, [...(groups.get(value) ?? []), event]); } return Object.fromEntries([...groups.entries()].map(([value, rows]) => [value, aggregateOrderBlockShadowMetrics(rows)])); }
