import type { AtrCalculation } from '../../analysis-utils/true-range.ts';
import type { NormalizedCandle, VolatilityRequirementObservation } from '../../contracts.ts';

export const LEGACY_VOLATILITY_THRESHOLD_MULTIPLIER = 0.8 as const;

/** Detector-specific legacy classification. ATR mathematics remain in simpleAtr(). */
export function calculateLegacyVolatilityRequirement(timeframe: string, source: readonly NormalizedCandle[], atr: AtrCalculation): VolatilityRequirementObservation | null {
  const current = source.at(-1);
  if (!current || atr.value === null || !atr.sufficientData || atr.sourceStartTime === null || atr.sourceEndTime === null) return null;
  const currentRange = Math.max(current.high - current.low, Number.EPSILON), volatilityThreshold = atr.value * LEGACY_VOLATILITY_THRESHOLD_MULTIPLIER, atrPositive = atr.value > 0, rangeAtOrAboveThreshold = currentRange >= volatilityThreshold, volatilityRequirementMet = atrPositive && rangeAtOrAboveThreshold;
  return { timeframe, classification: volatilityRequirementMet ? 'REQUIREMENT_MET' : 'REQUIREMENT_NOT_MET', volatilityRequirementMet, currentRange, atr: atr.value, atrPeriod: 14, atrSmoothingMethod: 'SIMPLE', thresholdMultiplier: LEGACY_VOLATILITY_THRESHOLD_MULTIPLIER, volatilityThreshold, rangeToAtrRatio: atr.value === 0 ? null : currentRange / atr.value, distanceFromThreshold: currentRange - volatilityThreshold, rangeAtOrAboveThreshold, atrPositive, open: current.open, high: current.high, low: current.low, close: current.close, candleCount: source.length, trueRangeCount: atr.trueRangeCount, sourceStartTime: atr.sourceStartTime, sourceEndTime: atr.sourceEndTime, eventCandleTime: current.openedAt };
}
