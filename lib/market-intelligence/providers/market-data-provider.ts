export type MarketDataRequest = {
  instrument: string;
  timeframe: string;
  candleCount: number;
  includeCurrentPrice: boolean;
  includeSpread: boolean;
  allowCached: boolean;
  /** Maximum acceptable market-data age in milliseconds. */
  maximumDataAge: number;
  /** ISO-8601 timestamp supplied by the caller. */
  requestedAt: string;
};

export type ProviderHealth = {
  status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
  checkedAt: string;
  message?: string;
};

export type ProviderCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type ProviderSnapshotResponse = {
  providerSymbol: string;
  candles: ProviderCandle[];
  currentPrice?: number;
  spread?: number;
  receivedAt: string;
  warnings: string[];
};

export interface MarketDataProvider {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly supportsReplay: boolean;
  readonly supportsHistorical: boolean;
  readonly supportedMarkets: readonly string[];
  readonly supportedTimeframes: readonly string[];
  health(): Promise<ProviderHealth>;
  fetchSnapshot(request: MarketDataRequest): Promise<ProviderSnapshotResponse>;
}
