import type { NormalizedCandle } from '../contracts.ts';
import { previousWindow, rollingMaximum, rollingMinimum } from './rolling-windows.ts';

export const STRUCTURAL_REFERENCE_WINDOW_SIZE = 7;
export const STRUCTURAL_MINIMUM_CANDLES = STRUCTURAL_REFERENCE_WINDOW_SIZE + 1;
export const LEGACY_PRIOR_STRUCTURE_WINDOW_SIZE = 12;
export const LEGACY_PRIOR_STRUCTURE_MINIMUM_CANDLES = 20;

export type StructuralWindow = {
  referenceCandles: NormalizedCandle[];
  eventCandle: NormalizedCandle;
  referenceHigh: number;
  referenceLow: number;
};

/** Preserves the legacy reference slice(-8, -1) and latest event candle. */
export function resolveLegacyStructuralWindow(candles: readonly NormalizedCandle[]): StructuralWindow | null {
  if (candles.length < STRUCTURAL_MINIMUM_CANDLES) return null;
  const reference = previousWindow(candles, STRUCTURAL_REFERENCE_WINDOW_SIZE, 1);
  const eventCandle = candles.at(-1);
  if (!reference.sufficientData || !eventCandle) return null;
  const referenceHigh = rollingMaximum(reference.values.map((candle) => candle.high));
  const referenceLow = rollingMinimum(reference.values.map((candle) => candle.low));
  return referenceHigh === null || referenceLow === null ? null : { referenceCandles: reference.values, eventCandle, referenceHigh, referenceLow };
}

/** Preserves the legacy slice(-20, -8) reference window and latest event candle. */
export function resolveLegacyPriorStructuralWindow(candles: readonly NormalizedCandle[]): StructuralWindow | null {
  if (candles.length < LEGACY_PRIOR_STRUCTURE_MINIMUM_CANDLES) return null;
  const referenceCandles = candles.slice(-20, -8);
  const eventCandle = candles.at(-1);
  if (referenceCandles.length !== LEGACY_PRIOR_STRUCTURE_WINDOW_SIZE || !eventCandle) return null;
  const referenceHigh = rollingMaximum(referenceCandles.map((candle) => candle.high));
  const referenceLow = rollingMinimum(referenceCandles.map((candle) => candle.low));
  return referenceHigh === null || referenceLow === null
    ? null
    : { referenceCandles: [...referenceCandles], eventCandle, referenceHigh, referenceLow };
}
