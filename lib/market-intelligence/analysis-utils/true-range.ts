import type { NormalizedCandle } from '../contracts.ts';

export type AtrCalculation = { value: number | null; period: number; smoothingMethod: 'SIMPLE'; candleCount: number; trueRangeCount: number; sourceStartTime: string | null; sourceEndTime: string | null; sufficientData: boolean };
export function trueRange(current: Pick<NormalizedCandle, 'high' | 'low'>, previous: Pick<NormalizedCandle, 'close'>): number | null {
  if (![current.high, current.low, previous.close].every(Number.isFinite) || current.high < current.low) return null;
  return Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close));
}
export function simpleAtr(candles: readonly NormalizedCandle[], period = 14): AtrCalculation {
  const validPeriod = Number.isInteger(period) && period > 0; const needed = validPeriod ? period + 1 : Number.POSITIVE_INFINITY; const source = validPeriod ? candles.slice(-needed) : [];
  const ranges: number[] = [];
  for (let index = 1; index < source.length; index++) { const value = trueRange(source[index], source[index - 1]); if (value !== null) ranges.push(value); }
  const sufficientData = validPeriod && source.length === needed && ranges.length === period;
  return { value: sufficientData ? ranges.reduce((total, value) => total + value, 0) / ranges.length : null, period, smoothingMethod: 'SIMPLE', candleCount: source.length, trueRangeCount: ranges.length, sourceStartTime: source[0]?.openedAt ?? null, sourceEndTime: source.at(-1)?.openedAt ?? null, sufficientData };
}
