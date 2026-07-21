import { previousWindow, resolveLegacyStructuralWindow, rollingMaximum, rollingMinimum } from '../../analysis-utils/index.ts';
import type { NormalizedCandle } from '../../contracts.ts';
import type { RangeLevelsCalculation } from './range-levels-types.ts';

export const RANGE_LEVELS_MINIMUM_CANDLES = 20;
export const RECENT_WINDOW_SIZE = 7;
export const PREVIOUS_WINDOW_SIZE = 12;

/** Preserves legacy slices: recent = slice(-8, -1), previous = slice(-20, -8). */
export function calculateLegacyRangeLevels(candles: readonly NormalizedCandle[]): RangeLevelsCalculation | null {
  if (candles.length < RANGE_LEVELS_MINIMUM_CANDLES) return null;
  const structural = resolveLegacyStructuralWindow(candles);
  const previous = previousWindow(candles, PREVIOUS_WINDOW_SIZE, 8);
  if (!structural || !previous.sufficientData) return null;
  const recentHigh = structural.referenceHigh;
  const recentLow = structural.referenceLow;
  const previousHigh = rollingMaximum(previous.values.map((candle) => candle.high));
  const previousLow = rollingMinimum(previous.values.map((candle) => candle.low));
  if (recentHigh === null || recentLow === null || previousHigh === null || previousLow === null) return null;
  const source = candles.slice(-RANGE_LEVELS_MINIMUM_CANDLES); const last = candles.at(-1)!;
  return { recentHigh, recentLow, previousHigh, previousLow, midpoint: (recentHigh + recentLow) / 2, range: recentHigh - recentLow, candleCount: source.length, sourceStartTime: source[0].openedAt, sourceEndTime: source.at(-1)!.openedAt, lastCandleTime: last.openedAt, evidenceTimes: source.map((candle) => candle.openedAt) };
}
