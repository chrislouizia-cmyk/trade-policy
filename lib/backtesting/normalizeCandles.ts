import type { BacktestDataset, Candle } from './types.ts';

export type RawCandle = Readonly<{ timestamp?: string | number; datetime?: string; open: number | string; high: number | string; low: number | string; close: number | string; volume?: number | string | null }>;
export type DuplicatePolicy = 'REJECT' | 'KEEP_LAST';

function normalizedTimestamp(value: string | number): string {
  const parsed = typeof value === 'number' ? value : Date.parse(value.includes('T') ? value : value.replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(value) ? '' : 'Z'));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid candle timestamp: ${String(value)}.`);
  return new Date(parsed).toISOString();
}
export function normalizeCandles(input: readonly RawCandle[], duplicatePolicy: DuplicatePolicy = 'REJECT'): readonly Candle[] {
  const byTimestamp = new Map<string, Candle>();
  for (const raw of input) {
    const sourceTimestamp = raw.timestamp ?? raw.datetime;
    if (sourceTimestamp === undefined) throw new Error('Candle timestamp is required.');
    const timestamp = normalizedTimestamp(sourceTimestamp);
    const candle: Candle = Object.freeze({ timestamp, open: Number(raw.open), high: Number(raw.high), low: Number(raw.low), close: Number(raw.close), ...(raw.volume == null ? {} : { volume: Number(raw.volume) }) });
    if (![candle.open, candle.high, candle.low, candle.close, ...(candle.volume === undefined ? [] : [candle.volume])].every(Number.isFinite)) throw new Error(`Candle ${timestamp} contains a non-finite value.`);
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.low > candle.high) throw new Error(`Candle ${timestamp} has impossible OHLC geometry.`);
    if (byTimestamp.has(timestamp) && duplicatePolicy === 'REJECT') throw new Error(`Duplicate candle timestamp: ${timestamp}.`);
    byTimestamp.set(timestamp, candle);
  }
  return Object.freeze([...byTimestamp.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)));
}

export function createBacktestDataset(input: Omit<BacktestDataset, 'candles' | 'startTime' | 'endTime'> & { candles: readonly RawCandle[] }, duplicatePolicy: DuplicatePolicy = 'REJECT'): BacktestDataset {
  const candles = normalizeCandles(input.candles, duplicatePolicy);
  if (!candles.length) throw new Error('Backtest dataset must contain at least one candle.');
  return Object.freeze({ ...input, candles, startTime: candles[0]!.timestamp, endTime: candles.at(-1)!.timestamp });
}
