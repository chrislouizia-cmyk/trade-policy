import type { OrderBlockShadowMetricEvent, OrderBlockShadowMetrics } from './order-block-shadow-metrics.ts';
import { aggregateOrderBlockShadowMetrics, segmentOrderBlockShadowMetrics } from './order-block-shadow-metrics.ts';

export type OrderBlockPromotionPolicy = Readonly<{ requiredTimeframes: readonly string[]; minimumResolvedComparisons: number; minimumResolvedPerTimeframe: number; minimumAgreementRate: number; maximumDisagreementRate: number; maximumUnavailableRate: number; maximumManualPassDetectorNone: number; maximumManualFailDetectorEligible: number; requireStrategyRevision: boolean }>;
export const CONSERVATIVE_ORDER_BLOCK_PROMOTION_POLICY: OrderBlockPromotionPolicy = Object.freeze({ requiredTimeframes: Object.freeze(['M5', 'M15', 'H1']), minimumResolvedComparisons: 100, minimumResolvedPerTimeframe: 20, minimumAgreementRate: .9, maximumDisagreementRate: .1, maximumUnavailableRate: .1, maximumManualPassDetectorNone: 5, maximumManualFailDetectorEligible: 5, requireStrategyRevision: true });
export type OrderBlockPromotionReadiness = Readonly<{ status: 'INSUFFICIENT_DATA' | 'NOT_READY' | 'READY_FOR_REVIEW'; resolvedComparisons: number; agreementRate: number | null; disagreementRate: number | null; blockers: readonly string[]; warnings: readonly string[]; report: Readonly<{ currentCapability: 'MANUAL'; promotionOccurred: false; overall: OrderBlockShadowMetrics; byTimeframe: Record<string, OrderBlockShadowMetrics> }> }>;

export function assessOrderBlockPromotionReadiness(events: readonly OrderBlockShadowMetricEvent[], policy: OrderBlockPromotionPolicy = CONSERVATIVE_ORDER_BLOCK_PROMOTION_POLICY): OrderBlockPromotionReadiness {
  const overall = aggregateOrderBlockShadowMetrics(events), byTimeframe = segmentOrderBlockShadowMetrics(events, 'timeframe'); const blockers: string[] = [], warnings: string[] = [];
  if (!overall.totalResolvedComparisons || overall.totalResolvedComparisons < policy.minimumResolvedComparisons) blockers.push(`Overall resolved comparisons must be at least ${policy.minimumResolvedComparisons}.`);
  for (const timeframe of policy.requiredTimeframes) { const value = byTimeframe[timeframe]; if (!value || value.totalResolvedComparisons < policy.minimumResolvedPerTimeframe) blockers.push(`${timeframe} requires at least ${policy.minimumResolvedPerTimeframe} resolved comparisons.`); }
  if (policy.requireStrategyRevision && events.some(event => !event.strategyRevision)) blockers.push('Strategy revision is required for every comparison.');
  if (overall.agreementRate === null) blockers.push('Agreement rate is unavailable.');
  if (blockers.length) return report('INSUFFICIENT_DATA', overall, byTimeframe, blockers, warnings);
  if (overall.agreementRate! < policy.minimumAgreementRate) blockers.push(`Agreement rate is below ${policy.minimumAgreementRate}.`);
  if (overall.disagreementRate! > policy.maximumDisagreementRate) blockers.push(`Disagreement rate exceeds ${policy.maximumDisagreementRate}.`);
  const unavailableRate = overall.totalComparisons ? overall.unresolvedDetectorUnavailable / overall.totalComparisons : null;
  if (unavailableRate === null || unavailableRate > policy.maximumUnavailableRate) blockers.push(`Detector unavailable rate exceeds ${policy.maximumUnavailableRate}.`);
  if (overall.disagreeManualPassDetectorNone > policy.maximumManualPassDetectorNone) blockers.push('Manual PASS / detector NONE disagreement ceiling exceeded.');
  if (overall.disagreeManualFailDetectorEligible > policy.maximumManualFailDetectorEligible) blockers.push('Manual FAIL / detector ELIGIBLE disagreement ceiling exceeded.');
  if (overall.unresolvedManualPending) warnings.push(`${overall.unresolvedManualPending} manual confirmations remain pending.`);
  return report(blockers.length ? 'NOT_READY' : 'READY_FOR_REVIEW', overall, byTimeframe, blockers, warnings);
}
function report(status: OrderBlockPromotionReadiness['status'], overall: OrderBlockShadowMetrics, byTimeframe: Record<string, OrderBlockShadowMetrics>, blockers: string[], warnings: string[]): OrderBlockPromotionReadiness { return Object.freeze({ status, resolvedComparisons: overall.totalResolvedComparisons, agreementRate: overall.agreementRate, disagreementRate: overall.disagreementRate, blockers: Object.freeze(blockers), warnings: Object.freeze(warnings), report: Object.freeze({ currentCapability: 'MANUAL', promotionOccurred: false, overall, byTimeframe: Object.freeze(byTimeframe) }) }); }
