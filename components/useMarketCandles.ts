'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Candle } from '@/lib/market-analysis';

export type MarketSummary = {
  latest: Candle | null;
  previous: Candle | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  change: number | null;
  changePercent: number | null;
  provider: string | null;
  hasVolume: boolean;
  pricePrecision: number;
};

export function candleRangeForTimeframe(timeframe: string, now = new Date()): { from: string; to: string } {
  const days = timeframe === 'M1' || timeframe === 'M3' || timeframe === 'M5' ? 3
    : timeframe === 'M15' || timeframe === 'M30' ? 10
      : timeframe === 'H1' || timeframe === 'H2' ? 45
        : timeframe === 'H4' || timeframe === 'H6' || timeframe === 'H8' || timeframe === 'H12' ? 180
          : 730;
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: now.toISOString() };
}

export function formatPrice(value: number, instrument: string): string {
  const precision = getPricePrecisionForInstrument(instrument);
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision, useGrouping: false });
}

export function getPricePrecisionForInstrument(instrument: string): number {
  const name = instrument.toUpperCase();
  if (name.includes('JPY')) return 3;
  if (name.includes('XAU') || name.includes('XAG')) return 2;
  if (name.includes('USD') || name.includes('GBP') || name.includes('EUR') || name.includes('AUD') || name.includes('NZD') || name.includes('CAD') || name.includes('CHF')) return 5;
  return 4;
}

export function deriveMarketSummary(candles: readonly Candle[], instrument: string, provider?: string | null): MarketSummary {
  const latest = candles.at(-1) ?? null;
  const previous = candles.length > 1 ? candles.at(-2) ?? null : null;
  const open = latest?.open ?? null;
  const high = latest?.high ?? null;
  const low = latest?.low ?? null;
  const close = latest?.close ?? null;
  const change = latest && previous ? latest.close - previous.close : null;
  const changePercent = latest && previous && previous.close && change !== null ? (change / previous.close) * 100 : null;
  const hasVolume = candles.some((candle) => Number.isFinite(candle.volume));
  return {
    latest,
    previous,
    open,
    high,
    low,
    close,
    change,
    changePercent,
    provider: provider ?? null,
    hasVolume,
    pricePrecision: getPricePrecisionForInstrument(instrument),
  };
}

export function useMarketCandles(instrument: string, timeframe: string) {
  const range = useMemo(() => candleRangeForTimeframe(timeframe), [instrument, timeframe]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const inFlightRef = useRef(false);

  const fetchCandles = useCallback(async (manualRefresh = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (manualRefresh) {
      setRefreshing(true);
      setError('');
    } else {
      setLoading(true);
      setError('');
      setCandles([]);
      setProvider(null);
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ instrument, timeframe, from: range.from, to: range.to });
    try {
      const response = await fetch(`/api/market/candles?${params}`, { cache: 'no-store', signal: controller.signal });
      const payload = await response.json() as { candles?: Candle[]; provider?: string; error?: string };
      if (!response.ok || !Array.isArray(payload.candles)) throw new Error(payload.error || 'Market candles are unavailable.');
      setProvider(payload.provider ?? provider ?? null);
      setCandles(payload.candles);
      setError('');
    } catch (value) {
      if (!(value instanceof DOMException && value.name === 'AbortError')) {
        setError(value instanceof Error ? value.message : 'Market candles are unavailable.');
      }
    } finally {
      inFlightRef.current = false;
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [instrument, provider, range.from, range.to, timeframe]);

  const refetch = useCallback(async () => {
    await fetchCandles(true);
  }, [fetchCandles]);

  useEffect(() => {
    void fetchCandles(false);
  }, [fetchCandles]);

  return { candles, provider, loading, refreshing, error, range, refetch, summary: deriveMarketSummary(candles, instrument, provider) };
}
