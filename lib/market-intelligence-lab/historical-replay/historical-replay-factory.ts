import type { HistoricalDatasetRepository } from '../historical-datasets/dataset-types.ts';
import { calculateHistoricalDatasetHash, validateHistoricalDataset } from '../historical-datasets/dataset-validator.ts';
import { HistoricalReplayProvider } from './historical-replay-provider.ts';
import { HistoricalReplayError } from './historical-replay-types.ts';

export class HistoricalReplayProviderFactory {
  readonly #repository: HistoricalDatasetRepository;
  constructor(repository: HistoricalDatasetRepository) { this.#repository = repository; }
  async create(datasetId: string): Promise<HistoricalReplayProvider> {
    const dataset = await this.#repository.getDataset(datasetId);
    if (!dataset) throw new HistoricalReplayError('DATASET_NOT_FOUND', `Historical dataset was not found: ${datasetId}`);
    if (dataset.manifest.status !== 'CERTIFIED') throw new HistoricalReplayError('DATASET_NOT_CERTIFIED', `Historical replay requires a CERTIFIED dataset; received ${dataset.manifest.status}.`);
    const report = validateHistoricalDataset({ ...dataset.manifest, candles: dataset.candles });
    const hash = calculateHistoricalDatasetHash({ ...dataset.manifest, candles: dataset.candles });
    if (!report.valid || hash !== dataset.manifest.contentHash || dataset.candles.length !== dataset.manifest.candleCount || report.startAt !== dataset.manifest.startAt || report.endAt !== dataset.manifest.endAt) throw new HistoricalReplayError('DATASET_INTEGRITY_FAILURE', `Certified dataset integrity verification failed: ${datasetId}`);
    return new HistoricalReplayProvider(dataset);
  }
}
