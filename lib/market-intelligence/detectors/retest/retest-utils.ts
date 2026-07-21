import { simpleAtr, simpleMovingAverage } from '../../analysis-utils/index.ts';
import type { NormalizedCandle, RetestObservation } from '../../contracts.ts';
import { calculateLegacyRangeLevels } from '../range-levels/range-levels-utils.ts';
import { classifyLegacyTrend } from '../trend/trend-utils.ts';

export function isLegacyRetest(distanceToTarget: number, tolerance: number): boolean { return distanceToTarget <= tolerance; }

/** Composes existing deterministic primitives while preserving market-analysis.ts retest mathematics. */
export function calculateLegacyRetest(timeframe: string, candles: readonly NormalizedCandle[]): RetestObservation | null {
  if (candles.length < 24) return null;
  const source = candles.slice(-24), closes = source.map((candle) => candle.close), fast = simpleMovingAverage(closes, 10, 'close'), slow = simpleMovingAverage(closes, 24, 'close'), atr = simpleAtr(source, 14), levels = calculateLegacyRangeLevels(source), current = source.at(-1);
  if (!current || !fast.sufficientData || fast.value === null || !slow.sufficientData || slow.value === null || !atr.sufficientData || atr.value === null || !levels || atr.sourceStartTime === null || atr.sourceEndTime === null) return null;
  const trendBias = classifyLegacyTrend(fast.value, slow.value, current.close), targetLevel = trendBias === 'BULLISH' ? levels.recentHigh : levels.recentLow, atrTolerance = atr.value * 0.35, priceTolerance = current.close * 0.0002, tolerance = Math.max(atrTolerance, priceTolerance), distanceToTarget = Math.abs(current.close - targetLevel), retestDetected = isLegacyRetest(distanceToTarget, tolerance);
  const recent = source.slice(-8, -1);
  return { timeframe, classification: retestDetected ? 'RETEST' : 'NO_RETEST', retestDetected, trendBias, targetLevel, recentHigh: levels.recentHigh, recentLow: levels.recentLow, tolerance, atrTolerance, priceTolerance, distanceToTarget, atr: atr.value, atrPeriod: 14, atrSmoothingMethod: 'SIMPLE', currentClose: current.close, candleCount: source.length, atrCandleCount: atr.candleCount, trueRangeCount: atr.trueRangeCount, recentWindowSize: recent.length, sourceStartTime: source[0].openedAt, sourceEndTime: current.openedAt, recentStartTime: recent[0].openedAt, recentEndTime: recent.at(-1)!.openedAt, eventCandleTime: current.openedAt };
}
