import type { NormalizedCandle } from '../contracts.ts';
import { isCandleComplete } from './timeframes.ts';

export type CandleValidationIssue = { code: string; message: string; candleIndex?: number };
export type CandleValidationResult = { valid: boolean; sufficientData: boolean; candleCount: number; minimumRequired: number; issues: CandleValidationIssue[] };

export function validateCandles(candles: readonly NormalizedCandle[], options: { minimumHistory?: number; requireFiniteVolume?: boolean } = {}): CandleValidationResult {
  const minimumRequired = options.minimumHistory ?? 0; const issues: CandleValidationIssue[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  candles.forEach((candle, candleIndex) => {
    const opened = Date.parse(candle.openedAt); const closed = Date.parse(candle.closedAt);
    if (!Number.isFinite(opened) || !Number.isFinite(closed)) issues.push({ code: 'INVALID_TIMESTAMP', message: 'Candle timestamps must be valid ISO-8601 values.', candleIndex });
    else if (opened <= previous) issues.push({ code: 'INVALID_CANDLE_ORDER', message: 'Candle timestamps must be strictly ascending.', candleIndex });
    previous = opened;
    if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) issues.push({ code: 'INVALID_OHLC', message: 'OHLC values must be finite.', candleIndex });
    else if (candle.high < Math.max(candle.open, candle.close, candle.low) || candle.low > Math.min(candle.open, candle.close, candle.high)) issues.push({ code: 'IMPOSSIBLE_CANDLE_GEOMETRY', message: 'Candle high/low does not contain its OHLC values.', candleIndex });
    if (options.requireFiniteVolume && !Number.isFinite(candle.volume)) issues.push({ code: 'INVALID_VOLUME', message: 'Volume must be finite when required.', candleIndex });
  });
  return { valid: issues.length === 0, sufficientData: candles.length >= minimumRequired, candleCount: candles.length, minimumRequired, issues };
}

export function filterCompletedCandles(candles: readonly NormalizedCandle[], referenceTimestamp: string): { completed: NormalizedCandle[]; incomplete: NormalizedCandle[]; invalidTimestamp: NormalizedCandle[] } {
  const completed: NormalizedCandle[] = []; const incomplete: NormalizedCandle[] = []; const invalidTimestamp: NormalizedCandle[] = [];
  for (const candle of candles) { const state = isCandleComplete(candle, referenceTimestamp); (state === null ? invalidTimestamp : state ? completed : incomplete).push(candle); }
  return { completed, incomplete, invalidTimestamp };
}
