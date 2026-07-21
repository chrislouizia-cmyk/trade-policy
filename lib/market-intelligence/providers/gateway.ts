import type { MarketDataSnapshot, NormalizedCandle } from '../contracts.ts';
import type { ProviderRegistry } from './provider-registry.ts';
import type { MarketDataRequest, ProviderCandle, ProviderSnapshotResponse } from './market-data-provider.ts';
import { timeframeDurationMs } from '../analysis-utils/timeframes.ts';
import { stableFingerprint } from '../serialization/stable-fingerprint.ts';

export class MarketDataGatewayError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'MarketDataGatewayError';
  }
}

type GatewayOptions = {
  timeoutMs?: number;
  createSnapshotId?: (request: MarketDataRequest, response: ProviderSnapshotResponse) => string;
};

function timestamp(value: string, field: string): number {
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new MarketDataGatewayError('INVALID_TIMESTAMP', `${field} must be a valid ISO-8601 timestamp.`);
  return parsed;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function validateRequest(request: MarketDataRequest): number {
  if (!/^[A-Z0-9._/-]{1,30}$/i.test(request.instrument.trim())) throw new MarketDataGatewayError('INVALID_INSTRUMENT', 'Instrument is invalid.');
  if (timeframeDurationMs(request.timeframe) === null) throw new MarketDataGatewayError('INVALID_TIMEFRAME', 'Timeframe is unsupported.');
  if (!Number.isInteger(request.candleCount) || request.candleCount < 1 || request.candleCount > 5_000) throw new MarketDataGatewayError('INVALID_CANDLE_COUNT', 'Candle count must be an integer from 1 to 5000.');
  if (!Number.isFinite(request.maximumDataAge) || request.maximumDataAge < 0) throw new MarketDataGatewayError('INVALID_MAXIMUM_DATA_AGE', 'Maximum data age must be a non-negative number.');
  return timestamp(request.requestedAt, 'requestedAt');
}

function normalizeCandles(candles: ProviderCandle[], interval: number, requestedMs: number): NormalizedCandle[] {
  if (!candles.length) throw new MarketDataGatewayError('MISSING_CANDLES', 'Provider returned no candles.');
  let previous = Number.NEGATIVE_INFINITY;
  return candles.map((candle, index) => {
    const openedMs = timestamp(candle.timestamp, `candles[${index}].timestamp`);
    if (openedMs <= previous) throw new MarketDataGatewayError('INVALID_CANDLE_ORDER', 'Candles must be strictly ordered from oldest to newest.');
    previous = openedMs;
    if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) throw new MarketDataGatewayError('INVALID_CANDLE', `Candle ${index} contains a non-finite OHLC value.`);
    if (candle.high < Math.max(candle.open, candle.close, candle.low) || candle.low > Math.min(candle.open, candle.close, candle.high)) throw new MarketDataGatewayError('INVALID_CANDLE', `Candle ${index} has an invalid OHLC range.`);
    const closedMs = openedMs + interval;
    return {
      openedAt: new Date(openedMs).toISOString(),
      closedAt: new Date(closedMs).toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume == null ? null : candle.volume,
      complete: closedMs <= requestedMs,
    };
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new MarketDataGatewayError('PROVIDER_TIMEOUT', `Market-data provider timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class MarketDataGateway {
  readonly #registry: ProviderRegistry;
  readonly #timeoutMs: number;
  readonly #createSnapshotId: (request: MarketDataRequest, response: ProviderSnapshotResponse) => string;

  constructor(registry: ProviderRegistry, options: GatewayOptions = {}) {
    this.#registry = registry;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#createSnapshotId = options.createSnapshotId ?? ((request, response) => `snapshot:${stableFingerprint({ request, providerSymbol: response.providerSymbol, candles: response.candles, currentPrice: response.currentPrice ?? null, spread: response.spread ?? null })}`);
  }

  async fetchSnapshot(providerId: string, request: MarketDataRequest): Promise<MarketDataSnapshot> {
    const requestedMs = validateRequest(request);
    const provider = this.#registry.get(providerId);
    if (!provider) throw new MarketDataGatewayError('PROVIDER_NOT_REGISTERED', `Market-data provider is not registered: ${providerId}`);
    if (!provider.supportedTimeframes.includes(request.timeframe)) throw new MarketDataGatewayError('PROVIDER_TIMEFRAME_UNSUPPORTED', `${provider.displayName} does not support ${request.timeframe}.`);

    let response;
    try {
      response = await withTimeout(provider.fetchSnapshot(request), this.#timeoutMs);
    } catch (error) {
      if (error instanceof MarketDataGatewayError) throw error;
      throw new MarketDataGatewayError('PROVIDER_FAILURE', error instanceof Error ? error.message : 'Market-data provider failed.');
    }

    const interval = timeframeDurationMs(request.timeframe)!;
    const candles = normalizeCandles(response.candles, interval, requestedMs);
    timestamp(response.receivedAt, 'receivedAt');
    const dataAsOfMs = timestamp(candles.at(-1)!.openedAt, 'dataAsOf');
    const ageMs = Math.max(0, requestedMs - dataAsOfMs);
    const stale = ageMs > request.maximumDataAge;
    const incompleteCount = candles.filter((candle) => !candle.complete).length;
    const validationWarnings = [...response.warnings];
    if (stale) validationWarnings.push('Market data is stale.');
    if (incompleteCount) validationWarnings.push(`${incompleteCount} incomplete candle${incompleteCount === 1 ? '' : 's'} detected.`);
    const dataAsOf = new Date(dataAsOfMs).toISOString();
    const snapshot: MarketDataSnapshot = {
      id: this.#createSnapshotId(request, response),
      snapshotVersion: '1.0.0',
      provider: provider.id,
      providerVersion: provider.version,
      providerSymbol: response.providerSymbol,
      instrument: request.instrument.trim().toUpperCase(),
      timeframe: request.timeframe,
      requestedAt: new Date(requestedMs).toISOString(),
      receivedAt: new Date(timestamp(response.receivedAt, 'receivedAt')).toISOString(),
      dataAsOf,
      freshness: { state: stale ? 'STALE' : 'FRESH', dataAsOf, ageMs, maximumAgeMs: request.maximumDataAge },
      candles,
      ...(response.currentPrice === undefined ? {} : { currentPrice: response.currentPrice }),
      ...(response.spread === undefined ? {} : { spread: response.spread }),
      validationWarnings,
    };
    return deepFreeze(snapshot);
  }
}
