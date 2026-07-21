import { candleAnatomy } from '../../analysis-utils/index.ts';
import type { AtrCalculation } from '../../analysis-utils/true-range.ts';
import type { DisplacementObservation, NormalizedCandle } from '../../contracts.ts';

export const LEGACY_ATR_THRESHOLD_MULTIPLIER = 1.1 as const;
export const LEGACY_BODY_RATIO_THRESHOLD_MULTIPLIER = 0.65 as const;

/** Detector-specific legacy classification. ATR mathematics remain in simpleAtr(). */
export function calculateLegacyDisplacement(timeframe: string, source: readonly NormalizedCandle[], atr: AtrCalculation): DisplacementObservation | null {
  const current = source.at(-1), anatomy = current ? candleAnatomy(current) : null;
  if (!current || !anatomy || atr.value === null || !atr.sufficientData || atr.sourceStartTime === null || atr.sourceEndTime === null) return null;
  const fullRange = Math.max(current.high - current.low, Number.EPSILON);
  const atrThreshold = atr.value * LEGACY_ATR_THRESHOLD_MULTIPLIER;
  const bodyRatioThreshold = fullRange * LEGACY_BODY_RATIO_THRESHOLD_MULTIPLIER;
  const effectiveThreshold = Math.max(atrThreshold, bodyRatioThreshold);
  const bodyAboveAtrThreshold = anatomy.bodySize > atrThreshold, bodyAboveRangeThreshold = anatomy.bodySize > bodyRatioThreshold;
  const displacementDetected = anatomy.bodySize > effectiveThreshold;
  return { timeframe, classification: displacementDetected ? 'DISPLACEMENT' : 'NOT_DISPLACEMENT', displacementDetected, bodySize: anatomy.bodySize, fullRange, bodyToRangeRatio: fullRange === 0 ? null : anatomy.bodySize / fullRange, atr: atr.value, atrPeriod: 14, atrSmoothingMethod: 'SIMPLE', atrThresholdMultiplier: LEGACY_ATR_THRESHOLD_MULTIPLIER, atrThreshold, bodyRatioThresholdMultiplier: LEGACY_BODY_RATIO_THRESHOLD_MULTIPLIER, bodyRatioThreshold, effectiveThreshold, distanceAboveEffectiveThreshold: anatomy.bodySize - effectiveThreshold, bodyAboveAtrThreshold, bodyAboveRangeThreshold, open: current.open, high: current.high, low: current.low, close: current.close, candleCount: source.length, trueRangeCount: atr.trueRangeCount, sourceStartTime: atr.sourceStartTime, sourceEndTime: atr.sourceEndTime, eventCandleTime: current.openedAt };
}
