import type { TrendDirection, TrendStrength } from './trend-types.ts';

export function classifyLegacyTrend(fastAverage: number, slowAverage: number, latestClose: number): TrendDirection {
  if (fastAverage > slowAverage && latestClose > slowAverage) return 'BULLISH';
  if (fastAverage < slowAverage && latestClose < slowAverage) return 'BEARISH';
  return 'RANGE';
}

/**
 * Observation-strength metadata only; it is not trade quality or probability.
 * Absolute SMA separation and close-to-slow distance are normalized by the
 * slow SMA, averaged, scaled by 100, and clamped to [0, 1]. A zero divisor
 * leaves percent fields unavailable and produces the conservative value 0.
 */
export function calculateTrendStrength(fastAverage: number, slowAverage: number, latestClose: number): TrendStrength {
  const fastSlowDifference = fastAverage - slowAverage;
  const closeToSlowDifference = latestClose - slowAverage;
  const divisor = Math.abs(slowAverage);
  const fastSlowDifferencePercent = divisor === 0 ? null : fastSlowDifference / divisor * 100;
  const closeToSlowDifferencePercent = divisor === 0 ? null : closeToSlowDifference / divisor * 100;
  const confidence = fastSlowDifferencePercent === null || closeToSlowDifferencePercent === null
    ? 0
    : Math.min(1, Math.max(0, (Math.abs(fastSlowDifferencePercent) + Math.abs(closeToSlowDifferencePercent)) / 2));
  return { fastSlowDifference, fastSlowDifferencePercent, closeToSlowDifference, closeToSlowDifferencePercent, confidence };
}
