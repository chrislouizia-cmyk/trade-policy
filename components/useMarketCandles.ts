'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Candle } from '@/lib/market-analysis';

export function candleRangeForTimeframe(timeframe: string, now = new Date()): { from: string; to: string } {
  const days = timeframe === 'M1' || timeframe === 'M3' || timeframe === 'M5' ? 3
    : timeframe === 'M15' || timeframe === 'M30' ? 10
      : timeframe === 'H1' || timeframe === 'H2' ? 45
        : timeframe === 'H4' || timeframe === 'H6' || timeframe === 'H8' || timeframe === 'H12' ? 180
          : 730;
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: now.toISOString() };
}

export function useMarketCandles(instrument: string, timeframe: string) {
  const range = useMemo(() => candleRangeForTimeframe(timeframe), [instrument, timeframe]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setCandles([]);
    const params = new URLSearchParams({ instrument, timeframe, from: range.from, to: range.to });
    void fetch(`/api/market/candles?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { candles?: Candle[]; error?: string };
        if (!response.ok || !Array.isArray(payload.candles)) throw new Error(payload.error || 'Market candles are unavailable.');
        setCandles(payload.candles);
      })
      .catch((value) => { if (!(value instanceof DOMException && value.name === 'AbortError')) setError(value instanceof Error ? value.message : 'Market candles are unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [instrument, timeframe, range.from, range.to]);

  return { candles, loading, error, range };
}
