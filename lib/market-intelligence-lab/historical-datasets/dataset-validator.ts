import { timeframeDurationMs } from '../../market-intelligence/analysis-utils/timeframes.ts';
import type { NormalizedCandle } from '../../market-intelligence/contracts.ts';
import type { DatasetValidationIssue, DatasetValidationReport, HistoricalDatasetImport } from './dataset-types.ts';
import { stableFingerprint } from '../../market-intelligence/serialization/stable-fingerprint.ts';

const iso = (value: string): number => Date.parse(value);
export function validateHistoricalDataset(input: HistoricalDatasetImport): DatasetValidationReport {
  const issues: DatasetValidationIssue[] = [], warnings: string[] = [], interval = timeframeDurationMs(input.timeframe);
  if (!input.name.trim()) issues.push({ code: 'MISSING_NAME', index: null, message: 'Dataset name is required.' });
  if (!/^\d+\.\d+\.\d+$/.test(input.version)) issues.push({ code: 'INVALID_VERSION', index: null, message: 'Dataset version must use semantic versioning.' });
  if (!/^[A-Z0-9._/-]{1,30}$/i.test(input.instrument.trim())) issues.push({ code: 'INVALID_INSTRUMENT', index: null, message: 'Dataset instrument is invalid.' });
  if (!input.assetClass.trim() || !input.provider.trim() || !input.createdBy.trim()) issues.push({ code: 'INCOMPLETE_PROVENANCE', index: null, message: 'Asset class, provider, and creator are required.' });
  if (interval === null) issues.push({ code: 'INVALID_TIMEFRAME', index: null, message: `Unsupported timeframe: ${input.timeframe}.` });
  if (!input.candles.length) issues.push({ code: 'EMPTY_DATASET', index: null, message: 'At least one candle is required.' });
  let previousOpened = Number.NEGATIVE_INFINITY, previousClosed = Number.NEGATIVE_INFINITY, missingIntervalCount = 0;
  input.candles.forEach((candle, index) => {
    const opened = iso(candle.openedAt), closed = iso(candle.closedAt);
    if (!Number.isFinite(opened) || !Number.isFinite(closed)) issues.push({ code: 'INVALID_TIMESTAMP', index, message: `Candle ${index} has an invalid timestamp.` });
    else {
      if (opened <= previousOpened) issues.push({ code: 'INVALID_ORDER', index, message: `Candle ${index} is not strictly ordered.` });
      if (closed <= opened) issues.push({ code: 'INVALID_CLOSE_TIME', index, message: `Candle ${index} must close after it opens.` });
      if (interval !== null && closed - opened !== interval) issues.push({ code: 'INVALID_DURATION', index, message: `Candle ${index} duration does not match ${input.timeframe}.` });
      if (previousClosed !== Number.NEGATIVE_INFINITY && opened < previousClosed) issues.push({ code: 'OVERLAPPING_CANDLE', index, message: `Candle ${index} overlaps the previous candle.` });
      if (interval !== null && previousOpened !== Number.NEGATIVE_INFINITY && opened - previousOpened > interval) missingIntervalCount += Math.max(0, Math.round((opened - previousOpened) / interval) - 1);
      previousOpened = opened; previousClosed = closed;
    }
    if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) issues.push({ code: 'NON_FINITE_OHLC', index, message: `Candle ${index} contains a non-finite OHLC value.` });
    else if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.low > candle.high) issues.push({ code: 'INVALID_GEOMETRY', index, message: `Candle ${index} has impossible OHLC geometry.` });
    if (candle.volume !== null && (!Number.isFinite(candle.volume) || candle.volume < 0)) issues.push({ code: 'INVALID_VOLUME', index, message: `Candle ${index} volume must be null or non-negative.` });
    if (!candle.complete) issues.push({ code: 'INCOMPLETE_CANDLE', index, message: `Historical dataset candle ${index} is incomplete.` });
  });
  if (missingIntervalCount) warnings.push(`${missingIntervalCount} expected interval slots are absent; market closures may be valid but must be reviewed.`);
  const startAt = input.candles.length && Number.isFinite(iso(input.candles[0]!.openedAt)) ? new Date(iso(input.candles[0]!.openedAt)).toISOString() : null, endAt = input.candles.length && Number.isFinite(iso(input.candles.at(-1)!.closedAt)) ? new Date(iso(input.candles.at(-1)!.closedAt)).toISOString() : null;
  return Object.freeze({ valid: issues.length === 0, candleCount: input.candles.length, startAt, endAt, missingIntervalCount, issues: Object.freeze(issues), warnings: Object.freeze(warnings) });
}

export function freezeCandles(candles: readonly NormalizedCandle[]): readonly NormalizedCandle[] { const values = candles.map((candle) => Object.freeze({ ...candle })); return Object.freeze(values); }

export function calculateHistoricalDatasetHash(input: Pick<HistoricalDatasetImport, 'version' | 'instrument' | 'assetClass' | 'timeframe' | 'provider' | 'candles'>): string {
  return stableFingerprint({ version: input.version, instrument: input.instrument, assetClass: input.assetClass, timeframe: input.timeframe, provider: input.provider, candles: input.candles });
}
