import type { NormalizedCandle } from '../contracts.ts';

export type WindowResult<T> = { values: T[]; requestedSize: number; sampleCount: number; sufficientData: boolean };
export function trailingWindow<T>(values: readonly T[], size: number): WindowResult<T> {
  const validSize = Number.isInteger(size) && size > 0; const selected = validSize ? values.slice(-size) : [];
  return { values: selected, requestedSize: size, sampleCount: selected.length, sufficientData: validSize && selected.length === size };
}
export function previousWindow<T>(values: readonly T[], size: number, offset = 0): WindowResult<T> {
  const valid = Number.isInteger(size) && size > 0 && Number.isInteger(offset) && offset >= 0; const end = values.length - offset; const selected = valid ? values.slice(Math.max(0, end - size), Math.max(0, end)) : [];
  return { values: selected, requestedSize: size, sampleCount: selected.length, sufficientData: valid && selected.length === size };
}
export function rollingMaximum(values: readonly number[]): number | null { return values.length && values.every(Number.isFinite) ? Math.max(...values) : null; }
export function rollingMinimum(values: readonly number[]): number | null { return values.length && values.every(Number.isFinite) ? Math.min(...values) : null; }
export function evidenceTimestamps(candles: readonly Pick<NormalizedCandle, 'openedAt'>[]): string[] { return candles.map((candle) => candle.openedAt); }
