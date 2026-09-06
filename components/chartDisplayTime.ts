import type { UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@/lib/market-analysis';

export function getTimeframeSecondsForDisplay(timeframe: string): number {
  switch ((timeframe ?? '').toUpperCase()) {
    case 'M1': return 60;
    case 'M5': return 300;
    case 'M15': return 900;
    case 'M30': return 1800;
    case 'H1': return 3600;
    case 'H2': return 7200;
    case 'H4': return 14400;
    case 'H6': return 21600;
    case 'H8': return 28800;
    case 'D1': return 86400;
    default: return 3600;
  }
}

const chartTime = (datetime: string) => Math.floor(Date.parse(datetime) / 1000) as UTCTimestamp;

export function deriveDisplayChartTime(candles: readonly Candle[], index: number, timeframe: string): UTCTimestamp {
  if (!candles.length) return 0 as UTCTimestamp;
  if (index < 0 || index >= candles.length) return chartTime(candles.at(-1)!.datetime);
  const anchorMs = Date.parse(candles[0].datetime);
  const stepMs = getTimeframeSecondsForDisplay(timeframe) * 1000;
  return Math.floor((anchorMs + index * stepMs) / 1000) as UTCTimestamp;
}

export function buildDisplayChartData(candles: readonly Candle[], timeframe: string) {
  if (!candles.length) return [] as Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>;
  return candles.map((candle, index) => ({
    time: deriveDisplayChartTime(candles, index, timeframe),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}
