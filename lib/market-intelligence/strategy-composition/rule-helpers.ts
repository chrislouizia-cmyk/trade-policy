import type { DetectorResult, MarketContext } from '../contracts.ts';
import type { EvidenceReference } from './composition-types.ts';

export function findObservation(context: MarketContext, detectorId: string, timeframe?: string): { result: DetectorResult; reference: EvidenceReference } | null {
  const resultIndex = context.detectorResults.findIndex((candidate) => candidate.detectorId === detectorId && (!timeframe || candidate.timeframe === timeframe));
  if (resultIndex < 0) return null;
  const result = context.detectorResults[resultIndex];
  return {
    result,
    reference: { detectorId, timeframe: result.timeframe, resultIndex, evidenceIds: result.evidence.map((item) => item.id) },
  };
}

export function configuredTimeframe(context: MarketContext, configuration: Record<string, unknown> | undefined): string | undefined {
  const value = configuration?.timeframe;
  if (typeof value === 'string' && value.trim()) return value;
  return context.timeframes[0];
}

export function configuredContribution(configuration: Record<string, unknown> | undefined, matched: boolean): number {
  const value = configuration?.confidenceContribution;
  return matched && typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : matched ? 1 : 0;
}
