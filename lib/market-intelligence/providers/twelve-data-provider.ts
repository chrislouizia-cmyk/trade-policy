import { fetchPrice, fetchSeries, providerSymbol } from '../../market-data.ts';
import type {
  MarketDataProvider,
  MarketDataRequest,
  ProviderHealth,
  ProviderSnapshotResponse,
} from './market-data-provider.ts';

type TwelveDataDependencies = {
  fetchSeries: typeof fetchSeries;
  fetchPrice: typeof fetchPrice;
  now: () => string;
};

const timeframes = ['M1','M3','M5','M15','M30','H1','H2','H4','H6','H8','H12','D1','W1','MN'] as const;

/** Adapter around the unchanged production Twelve Data implementation. */
export class TwelveDataProvider implements MarketDataProvider {
  readonly id = 'twelve-data';
  readonly version = '1.0.0';
  readonly displayName = 'Twelve Data';
  readonly supportsReplay = false;
  readonly supportsHistorical = true;
  readonly supportedMarkets = Object.freeze(['FOREX', 'METALS', 'STOCKS', 'ETFS', 'CRYPTO', 'INDEX']);
  readonly supportedTimeframes = Object.freeze([...timeframes]);
  readonly #dependencies: TwelveDataDependencies;

  constructor(dependencies: Partial<TwelveDataDependencies> = {}) {
    this.#dependencies = {
      fetchSeries: dependencies.fetchSeries ?? fetchSeries,
      fetchPrice: dependencies.fetchPrice ?? fetchPrice,
      now: dependencies.now ?? (() => new Date().toISOString()),
    };
  }

  async health(): Promise<ProviderHealth> {
    return process.env.TWELVE_DATA_API_KEY
      ? { status: 'HEALTHY', checkedAt: this.#dependencies.now() }
      : { status: 'UNAVAILABLE', checkedAt: this.#dependencies.now(), message: 'Twelve Data is not configured.' };
  }

  async fetchSnapshot(request: MarketDataRequest): Promise<ProviderSnapshotResponse> {
    const [candles, currentPrice] = await Promise.all([
      this.#dependencies.fetchSeries(request.instrument, request.timeframe, request.candleCount),
      request.includeCurrentPrice ? this.#dependencies.fetchPrice(request.instrument) : Promise.resolve(undefined),
    ]);
    return {
      providerSymbol: providerSymbol(request.instrument),
      candles: candles.map((candle) => ({
        timestamp: candle.datetime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume ?? null,
      })),
      currentPrice,
      receivedAt: this.#dependencies.now(),
      warnings: request.includeSpread ? ['Spread is unavailable from the current Twelve Data adapter.'] : [],
    };
  }
}
