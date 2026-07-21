import type { StructuralWindow } from '../../analysis-utils/index.ts';
import type { LiquiditySweepObservation } from '../../contracts.ts';

export function calculateLiquiditySweep(timeframe: string, window: StructuralWindow): LiquiditySweepObservation {
  const { referenceCandles, eventCandle: current, referenceHigh, referenceLow } = window;
  const closeReturnedInsideHigh = current.close < referenceHigh; const closeReturnedInsideLow = current.close > referenceLow;
  const highExceeded = current.high > referenceHigh; const lowExceeded = current.low < referenceLow;
  const highSideSweep = highExceeded && closeReturnedInsideHigh; const lowSideSweep = lowExceeded && closeReturnedInsideLow;
  const side = highSideSweep && lowSideSweep ? 'BOTH' : highSideSweep ? 'HIGH_SIDE' : lowSideSweep ? 'LOW_SIDE' : 'NONE';
  const highPenetration = highExceeded ? current.high - referenceHigh : null; const lowPenetration = lowExceeded ? referenceLow - current.low : null;
  const highPenetrationPercent = highPenetration === null || referenceHigh === 0 ? null : highPenetration / Math.abs(referenceHigh) * 100;
  const lowPenetrationPercent = lowPenetration === null || referenceLow === 0 ? null : lowPenetration / Math.abs(referenceLow) * 100;
  return { timeframe, side, highSideSweep, lowSideSweep, referenceHigh, referenceLow, currentOpen: current.open, currentHigh: current.high, currentLow: current.low, currentClose: current.close, highPenetration, lowPenetration, highPenetrationPercent, lowPenetrationPercent, closeReturnedInsideHigh, closeReturnedInsideLow, referenceWindowSize: referenceCandles.length, candleCount: referenceCandles.length + 1, referenceStartTime: referenceCandles[0].openedAt, referenceEndTime: referenceCandles.at(-1)!.openedAt, eventCandleTime: current.openedAt };
}
