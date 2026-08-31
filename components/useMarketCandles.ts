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

export function resolveCandlesFetchOutcome(previousCandles: readonly Candle[], payload: unknown, manualRefresh: boolean, preservePrevious = false) {
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
    candles: preservePrevious ? [...previousCandles] : manualRefresh ? [...previousCandles] : [],
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

export function mergeIncomingCandles(previousCandles: readonly Candle[], incomingCandles: readonly Candle[]): Candle[] {
  if (!incomingCandles.length) return previousCandles.slice();
  const byTime = new Map<string, Candle>();
  for (const candle of previousCandles) {
    if (candle && typeof candle.datetime === 'string') byTime.set(candle.datetime, candle);
  }
  for (const candle of incomingCandles) {
    if (candle && typeof candle.datetime === 'string') byTime.set(candle.datetime, candle);
  }
  return [...byTime.values()].sort((left, right) => Date.parse(left.datetime) - Date.parse(right.datetime));
}

export function getPollingIntervalMs(timeframe: string): number {
  switch ((timeframe ?? '').toUpperCase()) {
    case 'M5': return 15_000;
    case 'M30': return 30_000;
    case 'H1': return 60_000;
    case 'H4': return 180_000;
    case 'D1': return 300_000;
    default: return 60_000;
  }
}

export function useMarketCandles(instrument: string, timeframe: string) {
  const range = useMemo(() => candleRangeForTimeframe(timeframe), [instrument, timeframe]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const inFlightRef = useRef(false);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  const fetchCandles = useCallback(async (manualRefresh = false, backgroundRefresh = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const previousCandles = candlesRef.current;

    if (manualRefresh) {
      setRefreshing(true);
      setError('');
    } else if (!backgroundRefresh) {
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
        const outcome = resolveCandlesFetchOutcome(previousCandles, payload, manualRefresh, backgroundRefresh);
        if (manualRefresh || !backgroundRefresh) {
          setError(outcome.error);
        }
        if (!backgroundRefresh) {
          setCandles([]);
          setProvider(null);
        }
        return;
      }
      const completedCandles = filterCompletedCandles(payload.candles, Date.now());
      const mergedCandles = backgroundRefresh ? mergeIncomingCandles(previousCandles, completedCandles) : completedCandles;
      setProvider(payload.provider ?? null);
      setCandles(mergedCandles);
      setError('');
    } catch (value) {
      if (!(value instanceof DOMException && value.name === 'AbortError')) {
        const outcome = resolveCandlesFetchOutcome(previousCandles, value, manualRefresh, backgroundRefresh);
        if (manualRefresh || !backgroundRefresh) {
          setError(outcome.error);
        }
        if (!backgroundRefresh) {
          setCandles([]);
          setProvider(null);
        }
      }
    } finally {
      inFlightRef.current = false;
      if (!controller.signal.aborted) {
        if (!backgroundRefresh) {
          setLoading(false);
        }
        if (manualRefresh || !backgroundRefresh) {
          setRefreshing(false);
        }
      }
    }
  }, [instrument, range.from, range.to, timeframe]);

  const refetch = useCallback(async () => {
    if (inFlightRef.current || loading || refreshing) return;
    await fetchCandles(true, false);
  }, [fetchCandles, loading, refreshing]);

  useEffect(() => {
    void fetchCandles(false, false);
  }, [fetchCandles]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchCandles(false, true);
    }, getPollingIntervalMs(timeframe));
    return () => window.clearInterval(interval);
  }, [timeframe, fetchCandles]);

  return { candles, provider, loading, refreshing, error, range, refetch, summary: deriveMarketSummary(candles, instrument, provider) };
}
