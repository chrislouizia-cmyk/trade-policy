'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiErrorMessage, readApiResponse } from '../lib/api-error.ts';
import type { Candle } from '../lib/market-analysis.ts';

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

export function normalizeMarketCandlesError(value: unknown, fallback: string): string {
  const payload = value && typeof value === 'object' && 'error' in value ? (value as { error?: unknown }).error ?? value : value;
  const message = apiErrorMessage(payload, fallback);
  if (typeof message === 'string' && message.trim()) return message;
  return fallback;
}

export function resolveCandlesFetchOutcome(previousCandles: readonly Candle[], payload: unknown, manualRefresh: boolean) {
  const fallback = manualRefresh ? 'Unable to refresh market data.' : 'Unable to load market data.';
  if (payload && typeof payload === 'object' && Array.isArray((payload as { candles?: unknown }).candles)) {
    const nextCandles = (payload as { candles: Candle[] }).candles;
    return {
      candles: [...nextCandles],
      provider: (payload as { provider?: string | null }).provider ?? null,
      error: '',
    };
  }
  return {
    candles: manualRefresh ? [...previousCandles] : [],
    provider: null,
    error: normalizeMarketCandlesError(payload, fallback),
  };
}

export function filterCompletedCandles(candles: readonly Candle[], referenceTimeMs = Date.now()): Candle[] {
  return candles.filter((candle) => {
    const timestampMs = Date.parse(candle.datetime);
    if (!Number.isFinite(timestampMs)) return false;
    return timestampMs <= referenceTimeMs;
  });
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
      const payload = await readApiResponse(response) as { candles?: Candle[]; provider?: string; error?: unknown; message?: string } | null;
      if (!response.ok || !Array.isArray(payload?.candles)) {
        const outcome = resolveCandlesFetchOutcome(candles, payload, manualRefresh);
        if (manualRefresh) {
          setError(outcome.error);
        } else {
          setCandles([]);
          setProvider(null);
          setError(outcome.error);
        }
        return;
      }
      const nextCandles = filterCompletedCandles(payload.candles, Date.now());
      setProvider(payload.provider ?? null);
      setCandles(nextCandles);
      setError('');
    } catch (value) {
      if (!(value instanceof DOMException && value.name === 'AbortError')) {
        const outcome = resolveCandlesFetchOutcome(candles, value, manualRefresh);
        if (manualRefresh) {
          setError(outcome.error);
        } else {
          setCandles([]);
          setProvider(null);
          setError(outcome.error);
        }
      }
    } finally {
      inFlightRef.current = false;
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [instrument, range.from, range.to, timeframe]);

  const refetch = useCallback(async () => {
    if (inFlightRef.current || loading || refreshing) return;
    await fetchCandles(true);
  }, [fetchCandles, loading, refreshing]);

  useEffect(() => {
    void fetchCandles(false);
  }, [fetchCandles]);

  return { candles, provider, loading, refreshing, error, range, refetch, summary: deriveMarketSummary(candles, instrument, provider) };
}
