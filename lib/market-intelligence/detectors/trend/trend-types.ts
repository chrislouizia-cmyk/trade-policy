import type { TrendObservation } from '../../contracts.ts';

export type TrendDirection = TrendObservation['direction'];
export type TrendStrength = {
  fastSlowDifference: number;
  fastSlowDifferencePercent: number | null;
  closeToSlowDifference: number;
  closeToSlowDifferencePercent: number | null;
  confidence: number;
};
