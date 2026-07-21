import type { NormalizedCandle } from '../contracts.ts';
export type CandleGeometry = { bodySize: number; totalRange: number; upperWick: number; lowerWick: number; bodyToRangeRatio: number | null; closeLocationInRange: number | null };
export function candleGeometry(candle: Pick<NormalizedCandle, 'open' | 'high' | 'low' | 'close'>): CandleGeometry | null {
  if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) || candle.high < Math.max(candle.open, candle.close, candle.low) || candle.low > Math.min(candle.open, candle.close, candle.high)) return null;
  const bodySize = Math.abs(candle.close - candle.open); const totalRange = candle.high - candle.low;
  return { bodySize, totalRange, upperWick: candle.high - Math.max(candle.open, candle.close), lowerWick: Math.min(candle.open, candle.close) - candle.low, bodyToRangeRatio: totalRange === 0 ? null : bodySize / totalRange, closeLocationInRange: totalRange === 0 ? null : (candle.close - candle.low) / totalRange };
}
export type CandleAnatomy = { bodySize: number; fullRange: number; upperWick: number; lowerWick: number; bodyToRangeRatio: number | null; upperWickToBodyRatio: number | null; lowerWickToBodyRatio: number | null };
export function candleAnatomy(candle: Pick<NormalizedCandle, 'open' | 'high' | 'low' | 'close'>): CandleAnatomy | null {
  const geometry = candleGeometry(candle);
  if (!geometry) return null;
  return { bodySize: geometry.bodySize, fullRange: geometry.totalRange, upperWick: geometry.upperWick, lowerWick: geometry.lowerWick, bodyToRangeRatio: geometry.bodyToRangeRatio, upperWickToBodyRatio: geometry.bodySize === 0 ? null : geometry.upperWick / geometry.bodySize, lowerWickToBodyRatio: geometry.bodySize === 0 ? null : geometry.lowerWick / geometry.bodySize };
}
