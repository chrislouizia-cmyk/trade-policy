import { timeframeDurationMs } from '../../market-intelligence/analysis-utils/timeframes.ts';
import { stableFingerprint } from '../../market-intelligence/serialization/stable-fingerprint.ts';
import { freezeCandles } from '../historical-datasets/dataset-validator.ts';
import { planAcquisitionChunks } from './chunk-planner.ts';
import type { HistoricalAcquisitionRequest, HistoricalAcquisitionResult } from './acquisition-types.ts';
import { HistoricalAcquisitionError } from './acquisition-types.ts';

type FetchLike = (url: URL) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
const intervalMap = { M5: '5min', M15: '15min', H1: '1h' } as const;
export class TwelveDataHistoricalAcquirer {
  readonly #apiKey: string; readonly #fetch: FetchLike;
  constructor(apiKey: string, fetcher: FetchLike = (url) => fetch(url, { cache: 'no-store' })) { if (!apiKey) throw new HistoricalAcquisitionError('INVALID_REQUEST', 'Twelve Data API credential is required.'); this.#apiKey = apiKey; this.#fetch = fetcher; }
  async acquire(request: HistoricalAcquisitionRequest): Promise<HistoricalAcquisitionResult> {
    const chunks = planAcquisitionChunks(request), interval = timeframeDurationMs(request.timeframe)!; const byTime = new Map<string, any>();
    for (const chunk of chunks) {
      const url = new URL('https://api.twelvedata.com/time_series');
      for (const [key, value] of Object.entries({ symbol: 'XAU/USD', interval: intervalMap[request.timeframe], timezone: 'UTC', start_date: chunk.startAt.slice(0, 19), end_date: chunk.endAt.slice(0, 19), order: 'ASC', apikey: this.#apiKey })) url.searchParams.set(key, value);
      const response = await this.#fetch(url), payload = await response.json();
      if (!response.ok || payload.status === 'error') throw new HistoricalAcquisitionError(payload.code === 400 && /No data/i.test(payload.message ?? '') ? 'NO_DATA' : 'PROVIDER_ERROR', `Twelve Data chunk ${chunk.chunkId} failed: ${payload.message ?? `HTTP ${response.status}`}`);
      if (!Array.isArray(payload.values)) throw new HistoricalAcquisitionError('INVALID_RESPONSE', `Twelve Data chunk ${chunk.chunkId} did not contain values.`);
      if (payload.values.length > 5_000) throw new HistoricalAcquisitionError('TOO_MANY_POINTS', `Twelve Data chunk ${chunk.chunkId} exceeded 5,000 points.`);
      for (const [index, row] of payload.values.entries()) { const opened = Date.parse(`${String(row.datetime).replace(' ', 'T')}Z`), closed = opened + interval; if (!Number.isFinite(opened) || opened < Date.parse(request.startAt) || opened >= Date.parse(request.endAt) || closed > Date.parse(request.endAt)) continue; const candle = { openedAt: new Date(opened).toISOString(), closedAt: new Date(closed).toISOString(), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: row.volume == null ? null : Number(row.volume), complete: true }; if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) throw new HistoricalAcquisitionError('INVALID_RESPONSE', `Chunk ${chunk.chunkId} row ${index} contains invalid OHLC.`); const existing = byTime.get(candle.openedAt); if (existing && JSON.stringify(existing) !== JSON.stringify(candle)) throw new HistoricalAcquisitionError('INVALID_RESPONSE', `Conflicting duplicate candle at ${candle.openedAt}.`); byTime.set(candle.openedAt, candle); }
    }
    const candles = freezeCandles([...byTime.values()].sort((left, right) => left.openedAt.localeCompare(right.openedAt)));
    if (!candles.length) throw new HistoricalAcquisitionError('NO_DATA', 'No historical candles were returned for the requested range.');
    const warnings: string[] = []; if (candles[0]!.openedAt > request.startAt || candles.at(-1)!.closedAt < request.endAt) warnings.push('Provider coverage does not touch one or both requested boundaries; market closure or limited provider history requires review.');
    const provenance = Object.freeze({ provider: 'Twelve Data' as const, providerSymbol: 'XAU/USD' as const, timezone: 'UTC' as const, timestampConvention: 'BAR_OPEN_UTC' as const, requestedStartAt: request.startAt, requestedEndAt: request.endAt, acquiredAt: request.acquiredAt, chunkCount: chunks.length, requestFingerprint: stableFingerprint({ ...request, chunks }), maximumPointsPerRequest: 5000 as const });
    return Object.freeze({ request: Object.freeze({ ...request }), candles, chunks, provenance, warnings: Object.freeze(warnings) });
  }
}
