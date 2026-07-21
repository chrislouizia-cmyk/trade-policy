import type { FairValueGapObservation, NormalizedCandle } from '../../contracts.ts';

/** Exact legacy classification from market-analysis.ts::analyzeTf. */
export function calculateLegacyFairValueGap(timeframe: string, source: readonly NormalizedCandle[]): FairValueGapObservation | null {
  if (source.length !== 3) return null;
  const reference = source[0], current = source[2];
  const bullishGap = current.low > reference.high;
  const bearishGap = current.high < reference.low;
  const direction = bullishGap ? 'BULLISH' : bearishGap ? 'BEARISH' : 'NONE';
  const gapTop = bullishGap ? current.low : bearishGap ? reference.low : null;
  const gapBottom = bullishGap ? reference.high : bearishGap ? current.high : null;
  const gapSize = gapTop === null || gapBottom === null ? null : gapTop - gapBottom;
  const gapSizePercent = gapSize === null || gapBottom === null || gapBottom === 0 ? null : gapSize / Math.abs(gapBottom) * 100;
  return { timeframe, direction, bullishGap, bearishGap, gapTop, gapBottom, gapSize, gapSizePercent, currentCandle: { open: current.open, high: current.high, low: current.low, close: current.close }, referenceCandle: { open: reference.open, high: reference.high, low: reference.low, close: reference.close }, candleCount: 3, sourceStartTime: reference.openedAt, sourceEndTime: current.openedAt, referenceCandleTime: reference.openedAt, eventCandleTime: current.openedAt };
}
