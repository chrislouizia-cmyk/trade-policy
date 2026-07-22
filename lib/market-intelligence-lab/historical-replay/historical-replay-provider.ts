import type { MarketDataProvider, MarketDataRequest, ProviderHealth, ProviderSnapshotResponse } from '../../market-intelligence/providers/market-data-provider.ts';
import type { HistoricalDataset } from '../historical-datasets/dataset-types.ts';
import type { HistoricalReplayProvenance } from './historical-replay-types.ts';
import { HistoricalReplayError } from './historical-replay-types.ts';

export class HistoricalReplayProvider implements MarketDataProvider {
  readonly id = 'historical-replay';
  readonly version = '1.0.0';
  readonly displayName = 'Certified Historical Replay';
  readonly supportsReplay = true;
  readonly supportsHistorical = true;
  readonly supportedMarkets: readonly string[];
  readonly supportedTimeframes: readonly string[];
  readonly provenance: HistoricalReplayProvenance;
  readonly #dataset: HistoricalDataset;

  constructor(dataset: HistoricalDataset) {
    if (dataset.manifest.status !== 'CERTIFIED') throw new HistoricalReplayError('DATASET_NOT_CERTIFIED', `Historical replay requires a CERTIFIED dataset; received ${dataset.manifest.status}.`);
    this.#dataset = dataset;
    this.supportedMarkets = Object.freeze([dataset.manifest.assetClass]);
    this.supportedTimeframes = Object.freeze([dataset.manifest.timeframe]);
    this.provenance = Object.freeze({ providerId: this.id, providerVersion: this.version, datasetId: dataset.manifest.id, datasetHash: dataset.manifest.contentHash, datasetVersion: dataset.manifest.version, datasetCertification: 'CERTIFIED', deterministic: true, noLookahead: true });
    Object.freeze(this);
  }

  async health(): Promise<ProviderHealth> { return Object.freeze({ status: 'HEALTHY', checkedAt: this.#dataset.manifest.certifiedAt ?? this.#dataset.manifest.sealedAt, message: `Certified dataset ${this.#dataset.manifest.id} is ready for deterministic replay.` }); }

  async fetchSnapshot(request: MarketDataRequest): Promise<ProviderSnapshotResponse> {
    if (request.instrument.trim().toUpperCase() !== this.#dataset.manifest.instrument) throw new HistoricalReplayError('INSTRUMENT_MISMATCH', `Dataset ${this.#dataset.manifest.id} contains ${this.#dataset.manifest.instrument}, not ${request.instrument}.`);
    if (request.timeframe !== this.#dataset.manifest.timeframe) throw new HistoricalReplayError('TIMEFRAME_MISMATCH', `Dataset ${this.#dataset.manifest.id} contains ${this.#dataset.manifest.timeframe}, not ${request.timeframe}.`);
    const requestedAt = Date.parse(request.requestedAt);
    if (!Number.isFinite(requestedAt)) throw new HistoricalReplayError('INVALID_REQUEST_TIME', 'requestedAt must be a valid ISO-8601 timestamp.');
    const eligible = this.#dataset.candles.filter((candle) => Date.parse(candle.closedAt) <= requestedAt);
    if (eligible.length < request.candleCount) throw new HistoricalReplayError('INSUFFICIENT_HISTORY', `Replay requested ${request.candleCount} completed candles, but only ${eligible.length} existed at ${request.requestedAt}.`);
    const selected = eligible.slice(-request.candleCount);
    const warnings = request.includeSpread ? ['Historical dataset does not contain spread data.'] : [];
    return {
      providerSymbol: this.#dataset.manifest.instrument,
      candles: selected.map((candle) => ({ timestamp: candle.openedAt, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume })),
      ...(request.includeCurrentPrice ? { currentPrice: selected.at(-1)!.close } : {}),
      receivedAt: new Date(requestedAt).toISOString(),
      warnings,
    };
  }
}
