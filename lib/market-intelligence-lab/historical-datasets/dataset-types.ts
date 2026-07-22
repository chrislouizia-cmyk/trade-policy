import type { NormalizedCandle } from '../../market-intelligence/contracts.ts';

export type HistoricalDatasetStatus = 'IMPORTED' | 'VALIDATED' | 'CERTIFIED' | 'ARCHIVED';
export type HistoricalDatasetManifest = {
  id: string;
  name: string;
  version: string;
  instrument: string;
  assetClass: string;
  timeframe: string;
  provider: string;
  status: HistoricalDatasetStatus;
  candleCount: number;
  startAt: string;
  endAt: string;
  contentHash: string;
  validationReport: DatasetValidationReport;
  createdBy: string;
  createdAt: string;
  sealedAt: string;
  validatedAt: string | null;
  certifiedAt: string | null;
};

export type HistoricalDataset = { manifest: HistoricalDatasetManifest; candles: readonly NormalizedCandle[] };
export type HistoricalDatasetImport = { name: string; version: string; instrument: string; assetClass: string; timeframe: string; provider: string; createdBy: string; candles: readonly NormalizedCandle[] };
export type DatasetValidationIssue = { code: string; index: number | null; message: string };
export type DatasetValidationReport = { valid: boolean; candleCount: number; startAt: string | null; endAt: string | null; missingIntervalCount: number; issues: readonly DatasetValidationIssue[]; warnings: readonly string[] };
export type PreparedHistoricalDataset = Omit<HistoricalDatasetManifest, 'id' | 'createdAt' | 'sealedAt' | 'validatedAt' | 'certifiedAt' | 'status'> & { candles: readonly NormalizedCandle[] };

export interface HistoricalDatasetRepository {
  saveImported(dataset: PreparedHistoricalDataset): Promise<HistoricalDatasetManifest>;
  getManifest(id: string): Promise<HistoricalDatasetManifest | null>;
  getDataset(id: string): Promise<HistoricalDataset | null>;
  list(): Promise<readonly HistoricalDatasetManifest[]>;
  transitionStatus(id: string, status: Exclude<HistoricalDatasetStatus, 'IMPORTED'>): Promise<HistoricalDatasetManifest>;
  archive(id: string): Promise<HistoricalDatasetManifest>;
}
