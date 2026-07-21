import type { NormalizedCandle } from '../contracts.ts';

export const TIMEFRAME_DURATION_MS = Object.freeze({
  M1: 60_000, M3: 180_000, M5: 300_000, M15: 900_000, M30: 1_800_000,
  H1: 3_600_000, H2: 7_200_000, H4: 14_400_000, H6: 21_600_000,
  H8: 28_800_000, H12: 43_200_000, D1: 86_400_000, W1: 604_800_000,
  MN: 2_592_000_000,
} as const);

export type SupportedTimeframe = keyof typeof TIMEFRAME_DURATION_MS;
export const SUPPORTED_TIMEFRAMES = Object.freeze(Object.keys(TIMEFRAME_DURATION_MS) as SupportedTimeframe[]);

export function normalizeTimeframe(value: string): string {
  const normalized = value.trim().toUpperCase();
  const aliases: Record<string, string> = { '1M': 'M1', '3M': 'M3', '5M': 'M5', '15M': 'M15', '30M': 'M30', '1H': 'H1', '2H': 'H2', '4H': 'H4', '6H': 'H6', '8H': 'H8', '12H': 'H12', '1D': 'D1', '1W': 'W1', '1MO': 'MN' };
  return aliases[normalized] ?? normalized;
}

export function isSupportedTimeframe(value: string): value is SupportedTimeframe {
  return normalizeTimeframe(value) in TIMEFRAME_DURATION_MS;
}

export function timeframeDurationMs(value: string): number | null {
  const normalized = normalizeTimeframe(value);
  return isSupportedTimeframe(normalized) ? TIMEFRAME_DURATION_MS[normalized] : null;
}

export function expectedCandleCloseTime(openedAt: string, timeframe: string): string | null {
  const opened = Date.parse(openedAt); const duration = timeframeDurationMs(timeframe);
  return Number.isFinite(opened) && duration !== null ? new Date(opened + duration).toISOString() : null;
}

export function isCandleComplete(candle: Pick<NormalizedCandle, 'openedAt' | 'closedAt'>, referenceTimestamp: string): boolean | null {
  const closed = Date.parse(candle.closedAt); const reference = Date.parse(referenceTimestamp);
  return Number.isFinite(closed) && Number.isFinite(reference) ? closed <= reference : null;
}
