import 'server-only';

import { twelveDataSymbolFor } from '@/lib/instrument-registry';

import { strategyFromSnapshot } from '@/lib/server/backtest-executor';
import { strategyTimeframes } from '@/lib/strategy-timeframes';
import type { BacktestRun } from '@/types/backtesting';
import type { Candle } from '@/lib/market-analysis';

const PROVIDER = 'Twelve Data';
const PROVIDER_CALL_BUDGET = 8;
const PROVIDER_WINDOW_MS = 60_000;
const MAX_ACCEPTABLE_TAIL_GAP_MS = 6 * 60 * 60 * 1000;

type ProviderBudgetState = {
  calls: number[];
};

const providerBudgetState: ProviderBudgetState = (() => {
  const root = globalThis as typeof globalThis & {
    __tradePoliceTwelveDataBudget?: ProviderBudgetState;
  };
  if (!root.__tradePoliceTwelveDataBudget) {
    root.__tradePoliceTwelveDataBudget = { calls: [] };
  }
  return root.__tradePoliceTwelveDataBudget;
})();

function pruneProviderBudget(now = Date.now()) {
  providerBudgetState.calls = providerBudgetState.calls.filter(
    (timestamp) => now - timestamp < PROVIDER_WINDOW_MS,
  );
}

function reserveProviderCall(): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  pruneProviderBudget(now);

  if (providerBudgetState.calls.length >= PROVIDER_CALL_BUDGET) {
    const oldest = providerBudgetState.calls[0] ?? now;
    const waitMs = Math.max(1_000, PROVIDER_WINDOW_MS - (now - oldest) + 1_000);
    return { allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1000) };
  }

  providerBudgetState.calls.push(now);
  return { allowed: true };
}

const FRAME_MINUTES: Record<string, number> = {
  M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H2: 120, H4: 240, D1: 1440, W1: 10080,
};

const TWELVE_INTERVAL: Record<string, string> = {
  M1: '1min', M5: '5min', M15: '15min', M30: '30min', H1: '1h', H2: '2h', H4: '4h', D1: '1day', W1: '1week',
};

type AdminClient = any;

export type HistoricalPreparation =
  | {
      ready: false;
      requestsUsed: number;
      retryAfterSeconds: number;
      message: string;
      historical?: never;
    }
  | {
      ready: true;
      requestsUsed: number;
      retryAfterSeconds: 0;
      message: string;
      historical: Record<string, Candle[]>;
    };


function isoWithoutZone(value: number) {
  return new Date(value).toISOString().slice(0, 19);
}

function retryableProviderError(message: string) {
  return /api credit|credits|current minute|rate limit|too many requests|429/i.test(message);
}

async function fetchChunk(instrument: string, timeframe: string, startMs: number, endMs: number) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error('TWELVE_DATA_API_KEY is not configured.');

  const interval = TWELVE_INTERVAL[timeframe];
  if (!interval) throw new Error(`Historical backtesting does not yet support timeframe ${timeframe}.`);

  const url = new URL('https://api.twelvedata.com/time_series');
  const params = {
    symbol: twelveDataSymbolFor(instrument),
    interval,
    timezone: 'UTC',
    start_date: isoWithoutZone(startMs),
    end_date: isoWithoutZone(endMs),
    order: 'ASC',
    apikey: apiKey,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json();

  if (!response.ok || payload?.status === 'error') {
    const message = payload?.message ?? `HTTP ${response.status}`;
    const error = new Error(`Twelve Data ${timeframe} request failed: ${message}`);
    (error as any).retryableProviderLimit = retryableProviderError(message);
    throw error;
  }

  if (!Array.isArray(payload?.values)) {
    throw new Error(`Twelve Data ${timeframe} response did not contain historical candles.`);
  }

  const minutes = FRAME_MINUTES[timeframe]!;
  return payload.values.map((row: any) => {
    const opened = Date.parse(`${String(row.datetime).replace(' ', 'T')}Z`);
    return {
      provider: PROVIDER,
      instrument,
      timeframe,
      opened_at: new Date(opened).toISOString(),
      closed_at: new Date(opened + minutes * 60_000).toISOString(),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: row.volume == null ? null : Number(row.volume),
    };
  }).filter((row: any) => [row.open, row.high, row.low, row.close].every(Number.isFinite));
}

async function getRange(admin: AdminClient, instrument: string, timeframe: string) {
  const { data, error } = await admin
    .from('backtest_historical_cache_ranges')
    .select('covered_start,covered_end')
    .eq('provider', PROVIDER)
    .eq('instrument', instrument)
    .eq('timeframe', timeframe)
    .maybeSingle();
  if (error) throw error;
  return data as { covered_start: string; covered_end: string } | null;
}

async function saveRange(
  admin: AdminClient,
  instrument: string,
  timeframe: string,
  coveredStart: string,
  coveredEnd: string,
) {
  const { error } = await admin.from('backtest_historical_cache_ranges').upsert({
    provider: PROVIDER,
    instrument,
    timeframe,
    covered_start: coveredStart,
    covered_end: coveredEnd,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider,instrument,timeframe' });
  if (error) throw error;
}

async function saveCandles(admin: AdminClient, rows: any[]) {
  if (!rows.length) return;
  const { error } = await admin
    .from('backtest_historical_candles')
    .upsert(rows, { onConflict: 'provider,instrument,timeframe,opened_at' });
  if (error) throw error;
}

async function readCandles(
  admin: AdminClient,
  instrument: string,
  timeframe: string,
  startAt: string,
  endAt: string,
): Promise<Candle[]> {
  const PAGE_SIZE = 1000;
  const rows: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from('backtest_historical_candles')
      .select('opened_at,open,high,low,close,volume')
      .eq('provider', PROVIDER)
      .eq('instrument', instrument)
      .eq('timeframe', timeframe)
      .gte('opened_at', startAt)
      .lt('opened_at', endAt)
      .order('opened_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;

    if (from > 250_000) {
      throw new Error(`Historical cache read for ${timeframe} exceeded the safe pagination limit.`);
    }
  }

  return rows.map((row: any) => ({
    datetime: row.opened_at,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    ...(row.volume == null ? {} : { volume: Number(row.volume) }),
  }));
}

export async function prepareHistoricalBacktestData(
  run: BacktestRun,
  admin: AdminClient,
): Promise<HistoricalPreparation> {
  const strategy = strategyFromSnapshot(run);
  const frames = [...new Set([...strategyTimeframes(strategy), run.execution_timeframe])];

  const periodStart = Date.parse(run.period_start);
  const periodEnd = Date.parse(run.period_end);
  let requestsUsed = 0;

  for (const timeframe of frames) {
    const minutes = FRAME_MINUTES[timeframe];
    if (!minutes || !TWELVE_INTERVAL[timeframe]) {
      throw new Error(`Historical backtesting does not yet support timeframe ${timeframe}.`);
    }

    const wantedStart = periodStart - minutes * 60_000 * 60;
    const wantedEnd = periodEnd;
    const chunkSpan = minutes * 60_000 * 4_500;

    let range = await getRange(admin, run.instrument, timeframe);

    while (
      !range ||
      Date.parse(range.covered_start) > wantedStart ||
      Date.parse(range.covered_end) < wantedEnd - MAX_ACCEPTABLE_TAIL_GAP_MS
    ) {
      if (requestsUsed >= PROVIDER_CALL_BUDGET) {
        return {
          ready: false,
          requestsUsed,
          retryAfterSeconds: 65,
          message: 'Historical data is still being prepared. Trade Police will continue in the next provider window.',
        };
      }

      const providerBudget = reserveProviderCall();
      if (!providerBudget.allowed) {
        return {
          ready: false,
          requestsUsed,
          retryAfterSeconds: providerBudget.retryAfterSeconds,
          message: 'Historical data is still being prepared. Trade Police will continue in the next provider window.',
        };
      }

      let chunkStart: number;
      let chunkEnd: number;

      if (!range) {
        chunkStart = wantedStart;
        chunkEnd = Math.min(wantedEnd, chunkStart + chunkSpan);
      } else if (Date.parse(range.covered_start) > wantedStart) {
        chunkEnd = Date.parse(range.covered_start);
        chunkStart = Math.max(wantedStart, chunkEnd - chunkSpan);
      } else {
        chunkStart = Date.parse(range.covered_end);
        chunkEnd = Math.min(wantedEnd, chunkStart + chunkSpan);
      }

      try {
        const rows = await fetchChunk(run.instrument, timeframe, chunkStart, chunkEnd);
        requestsUsed += 1;
        await saveCandles(admin, rows);

        const nextStart = range
          ? new Date(Math.min(Date.parse(range.covered_start), chunkStart)).toISOString()
          : new Date(chunkStart).toISOString();
        const nextEnd = range
          ? new Date(Math.max(Date.parse(range.covered_end), chunkEnd)).toISOString()
          : new Date(chunkEnd).toISOString();

        await saveRange(admin, run.instrument, timeframe, nextStart, nextEnd);
        range = { covered_start: nextStart, covered_end: nextEnd };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Historical provider request failed.';
        if ((error as any)?.retryableProviderLimit || retryableProviderError(message)) {
          console.warn('Backtest historical provider window exhausted', {
            runId: run.id,
            timeframe,
            requestsUsed,
            internalReason: message,
          });
          return {
            ready: false,
            requestsUsed,
            retryAfterSeconds: 65,
            message: 'Historical data is still being prepared. Trade Police will continue shortly.',
          };
        }
        throw error;
      }
    }
  }

  const historical: Record<string, Candle[]> = {};
  for (const timeframe of frames) {
    const minutes = FRAME_MINUTES[timeframe]!;
    const wantedStart = new Date(periodStart - minutes * 60_000 * 60).toISOString();
    historical[timeframe] = await readCandles(
      admin,
      run.instrument,
      timeframe,
      wantedStart,
      new Date(periodEnd).toISOString(),
    );
  }

  return {
    ready: true,
    requestsUsed,
    retryAfterSeconds: 0,
    message: requestsUsed
      ? `Historical data prepared with ${requestsUsed} provider request(s).`
      : 'Historical data loaded entirely from cache.',
    historical,
  };
}
