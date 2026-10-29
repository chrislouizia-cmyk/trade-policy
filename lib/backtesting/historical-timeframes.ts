export const HISTORICAL_TIMEFRAMES = Object.freeze({
  M1: { minutes: 1, providerInterval: '1min' },
  M5: { minutes: 5, providerInterval: '5min' },
  M15: { minutes: 15, providerInterval: '15min' },
  M30: { minutes: 30, providerInterval: '30min' },
  H1: { minutes: 60, providerInterval: '1h' },
  H2: { minutes: 120, providerInterval: '2h' },
  H4: { minutes: 240, providerInterval: '4h' },
  D1: { minutes: 1440, providerInterval: '1day' },
  W1: { minutes: 10080, providerInterval: '1week' },
} as const);

export type HistoricalTimeframe = keyof typeof HISTORICAL_TIMEFRAMES;

export function normalizeHistoricalTimeframe(value: string): string {
  return value.trim().toUpperCase();
}

export function isHistoricalTimeframe(value: string): value is HistoricalTimeframe {
  return normalizeHistoricalTimeframe(value) in HISTORICAL_TIMEFRAMES;
}
