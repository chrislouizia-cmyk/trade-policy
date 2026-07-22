export type HistoricalReplayProvenance = {
  providerId: 'historical-replay';
  providerVersion: '1.0.0';
  datasetId: string;
  datasetHash: string;
  datasetVersion: string;
  datasetCertification: 'CERTIFIED';
  deterministic: true;
  noLookahead: true;
};

export class HistoricalReplayError extends Error {
  readonly code: 'DATASET_NOT_FOUND' | 'DATASET_NOT_CERTIFIED' | 'DATASET_INTEGRITY_FAILURE' | 'INSTRUMENT_MISMATCH' | 'TIMEFRAME_MISMATCH' | 'INVALID_REQUEST_TIME' | 'INSUFFICIENT_HISTORY';
  constructor(code: HistoricalReplayError['code'], message: string) { super(message); this.name = 'HistoricalReplayError'; this.code = code; }
}
