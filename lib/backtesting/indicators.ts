import type { Candle } from './types.ts';

export function ema(candles: readonly Candle[], period: number): number | null {
  if (!Number.isInteger(period) || period < 1 || candles.length < period) return null;
  const closes = candles.map((candle) => candle.close);
  let value = closes.slice(0, period).reduce((sum, close) => sum + close, 0) / period;
  const multiplier = 2 / (period + 1);
  for (const close of closes.slice(period)) value = (close - value) * multiplier + value;
  return value;
}
export function atr(candles: readonly Candle[], period: number): number | null {
  if (!Number.isInteger(period) || period < 1 || candles.length < period + 1) return null;
  const window = candles.slice(-period - 1);
  return window.slice(1).reduce((sum, candle, index) => sum + Math.max(candle.high - candle.low, Math.abs(candle.high - window[index]!.close), Math.abs(candle.low - window[index]!.close)), 0) / period;
}

export function sma(values: readonly number[], period: number): number | null {
  if (!Number.isInteger(period) || period < 1 || values.length < period) return null;
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}
