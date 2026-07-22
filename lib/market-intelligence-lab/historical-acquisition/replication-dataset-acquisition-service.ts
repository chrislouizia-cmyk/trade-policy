import type { HistoricalDatasetManifest } from '../historical-datasets/dataset-types.ts';
import { HistoricalDatasetManager } from '../historical-datasets/dataset-manager.ts';
import { stableFingerprint } from '../../market-intelligence/serialization/stable-fingerprint.ts';
import type { HistoricalAcquisitionRequest, AcquisitionProvenance } from './acquisition-types.ts';
import type { TwelveDataHistoricalAcquirer } from './twelve-data-historical-acquirer.ts';

export type CertifiedAcquisitionArtifact = { artifactVersion: '1.0.0'; programId: 'TP-REP-XAUUSD-2026-01'; dataset: HistoricalDatasetManifest; acquisition: AcquisitionProvenance; certificationHash: string; immutable: true };
export class ReplicationDatasetAcquisitionService {
  readonly #acquirer: Pick<TwelveDataHistoricalAcquirer, 'acquire'>; readonly #datasets: HistoricalDatasetManager;
  constructor(acquirer: Pick<TwelveDataHistoricalAcquirer, 'acquire'>, datasets: HistoricalDatasetManager) { this.#acquirer = acquirer; this.#datasets = datasets; }
  async acquireAndCertify(request: HistoricalAcquisitionRequest, datasetVersion: string, createdBy: string): Promise<CertifiedAcquisitionArtifact> {
    const acquired = await this.#acquirer.acquire(request);
    const imported = await this.#datasets.importDataset({ name: `XAUUSD ${request.timeframe} ${request.startAt.slice(0, 10)} to ${request.endAt.slice(0, 10)}`, version: datasetVersion, instrument: request.instrument, assetClass: 'METALS', timeframe: request.timeframe, provider: `Twelve Data UTC ${acquired.provenance.requestFingerprint}`, createdBy, candles: acquired.candles });
    await this.#datasets.validate(imported.id); const dataset = await this.#datasets.certify(imported.id);
    const certificationHash = stableFingerprint({ programId: 'TP-REP-XAUUSD-2026-01', datasetId: dataset.id, datasetHash: dataset.contentHash, acquisition: acquired.provenance });
    return Object.freeze({ artifactVersion: '1.0.0', programId: 'TP-REP-XAUUSD-2026-01', dataset, acquisition: acquired.provenance, certificationHash, immutable: true });
  }
}
