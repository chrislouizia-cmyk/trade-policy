import { createHash } from 'node:crypto';
import { normalizeCandles, type RawCandle } from './normalizeCandles.ts';
import type { BacktestDataset, Candle } from './types.ts';

export type DatasetIntegrityStatus = 'VERIFIED_SOURCE' | 'USER_PROVIDED' | 'UNVERIFIED' | 'INVALID';
export type PriceRepresentation = 'BID' | 'ASK' | 'MIDPOINT' | 'UNKNOWN';
export type DatasetValidationFinding = Readonly<{ code: string; severity: 'WARNING' | 'ERROR'; row: number | null; message: string }>;
export type DatasetValidationReport = Readonly<{
  valid: boolean;
  malformedRows: number;
  invalidOhlcRelationships: number;
  duplicateTimestamps: number;
  outOfOrderCandles: number;
  gapsInExpectedTimestamps: number;
  zeroOrNegativePrices: number;
  impossibleValues: number;
  missingVolume: number;
  timezoneAmbiguity: number;
  weekendCandles: number;
  suspiciousDiscontinuities: number;
  findings: readonly DatasetValidationFinding[];
  transformations: readonly string[];
}>;
export type DatasetArtifactMetadata = Readonly<{
  instrument: string;
  provider: string;
  providerSymbol: string;
  timeframe: string;
  timezone: string;
  pricePrecision: number;
  datasetStart: string;
  datasetEnd: string;
  candleCount: number;
  importTimestamp: string;
  sourceFilename: string;
  sha256FileHash: string;
  missingCandlePolicy: 'PRESERVE_AND_REPORT';
  duplicateTimestampPolicy: 'REJECT' | 'KEEP_LAST';
  priceRepresentation: PriceRepresentation;
  status: DatasetIntegrityStatus;
  sourceVerificationReference: string | null;
}>;
export type ImmutableDatasetArtifact = Readonly<{ metadata: DatasetArtifactMetadata; dataset: BacktestDataset; validation: DatasetValidationReport }>;
export type DatasetImportRequest = Readonly<{
  bytes: Uint8Array;
  format: 'CSV' | 'JSON';
  instrument: string;
  provider: string;
  providerSymbol: string;
  timeframe: string;
  timezone: string;
  pricePrecision: number;
  importTimestamp: string;
  sourceFilename: string;
  duplicateTimestampPolicy: 'REJECT' | 'KEEP_LAST';
  priceRepresentation: PriceRepresentation;
  sourceVerificationReference?: string;
  userProvided?: boolean;
}>;

const timeframeMs: Readonly<Record<string, number>> = Object.freeze({ M1: 60_000, M5: 300_000, M15: 900_000, M30: 1_800_000, H1: 3_600_000, H4: 14_400_000, D1: 86_400_000 });
const raw = (value: Readonly<Record<string, unknown>>): RawCandle => ({ timestamp: value.timestamp as string ?? value.openedAt as string ?? value.datetime as string, open: value.open as number, high: value.high as number, low: value.low as number, close: value.close as number, volume: value.volume as number | null | undefined });

function parse(bytes: Uint8Array, format: DatasetImportRequest['format']): readonly RawCandle[] {
  const text = new TextDecoder().decode(bytes);
  if (format === 'JSON') {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('JSON dataset must be an array of candle objects.');
    return parsed.map((row, index) => {
      if (!row || typeof row !== 'object') throw new Error(`Malformed JSON candle at row ${index + 1}.`);
      return raw(row as Readonly<Record<string, unknown>>);
    });
  }
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/), headers = lines.shift()?.split(',').map((header) => header.trim()) ?? [];
  for (const field of ['timestamp', 'open', 'high', 'low', 'close']) if (!headers.includes(field)) throw new Error(`CSV is missing required column "${field}".`);
  return lines.filter(Boolean).map((line) => {
    const values = line.split(',').map((value) => value.trim()), record = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    return raw(record);
  });
}

function quality(rows: readonly RawCandle[], normalized: readonly Candle[], request: DatasetImportRequest, transformations: readonly string[]): DatasetValidationReport {
  const findings: DatasetValidationFinding[] = [];
  let malformedRows = 0, invalidOhlcRelationships = 0, duplicateTimestamps = 0, outOfOrderCandles = 0, gaps = 0, zeroOrNegative = 0, impossible = 0, missingVolume = 0, timezoneAmbiguity = 0, weekend = 0, discontinuities = 0;
  const seen = new Set<string>();
  let priorRaw = -Infinity;
  rows.forEach((row, index) => {
    const timestampValue = row.timestamp ?? row.datetime, timestamp = timestampValue === undefined ? NaN : Date.parse(String(timestampValue));
    if (!Number.isFinite(timestamp) || ![row.open, row.high, row.low, row.close].map(Number).every(Number.isFinite)) malformedRows += 1;
    if (Number.isFinite(timestamp) && timestamp < priorRaw) outOfOrderCandles += 1;
    if (Number.isFinite(timestamp)) priorRaw = timestamp;
    const key = String(timestampValue);
    if (seen.has(key)) duplicateTimestamps += 1; else seen.add(key);
    const [open, high, low, close] = [row.open, row.high, row.low, row.close].map(Number);
    if ([open, high, low, close].some((value) => value <= 0)) zeroOrNegative += 1;
    if ([open, high, low, close].every(Number.isFinite) && (high < Math.max(open, close) || low > Math.min(open, close) || low > high)) invalidOhlcRelationships += 1;
    if (row.volume == null) missingVolume += 1;
    if (typeof timestampValue === 'string' && !/[zZ]|[+-]\d\d:\d\d$/.test(timestampValue) && request.timezone === 'UNKNOWN') timezoneAmbiguity += 1;
  });
  const expected = timeframeMs[request.timeframe];
  for (let index = 0; index < normalized.length; index += 1) {
    const candle = normalized[index]!, date = new Date(candle.timestamp);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) weekend += 1;
    if (index) {
      const previous = normalized[index - 1]!, elapsed = Date.parse(candle.timestamp) - Date.parse(previous.timestamp);
      if (expected && elapsed > expected * 1.5) gaps += Math.max(1, Math.round(elapsed / expected) - 1);
      if (Math.abs(candle.open - previous.close) / previous.close > .1) discontinuities += 1;
    }
    if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) impossible += 1;
  }
  const count = (value: number, code: string, message: string, severity: 'WARNING' | 'ERROR' = 'WARNING') => { if (value) findings.push({ code, severity, row: null, message: `${message}: ${value}.` }); };
  count(malformedRows, 'MALFORMED_ROWS', 'Malformed rows', 'ERROR'); count(invalidOhlcRelationships, 'INVALID_OHLC', 'Invalid OHLC relationships', 'ERROR');
  count(duplicateTimestamps, 'DUPLICATE_TIMESTAMPS', 'Duplicate timestamps', request.duplicateTimestampPolicy === 'REJECT' ? 'ERROR' : 'WARNING');
  count(outOfOrderCandles, 'OUT_OF_ORDER', 'Out-of-order source candles'); count(gaps, 'TIME_GAPS', 'Missing expected candle intervals');
  count(zeroOrNegative, 'NON_POSITIVE_PRICE', 'Zero or negative prices', 'ERROR'); count(impossible, 'IMPOSSIBLE_VALUE', 'Impossible values', 'ERROR');
  count(missingVolume, 'MISSING_VOLUME', 'Candles without volume'); count(timezoneAmbiguity, 'TIMEZONE_AMBIGUITY', 'Ambiguous timestamps', 'ERROR');
  count(weekend, 'WEEKEND_CANDLES', 'Weekend candles'); count(discontinuities, 'SUSPICIOUS_DISCONTINUITY', 'Price discontinuities greater than 10%');
  return Object.freeze({ valid: !findings.some((finding) => finding.severity === 'ERROR'), malformedRows, invalidOhlcRelationships, duplicateTimestamps, outOfOrderCandles, gapsInExpectedTimestamps: gaps, zeroOrNegativePrices: zeroOrNegative, impossibleValues: impossible, missingVolume, timezoneAmbiguity, weekendCandles: weekend, suspiciousDiscontinuities: discontinuities, findings: Object.freeze(findings), transformations: Object.freeze([...transformations]) });
}

export function importDatasetArtifact(request: DatasetImportRequest): ImmutableDatasetArtifact {
  const rows = parse(request.bytes, request.format), transformations = ['Parsed source file.', 'Normalized timestamps to ISO-8601 UTC.', 'Sorted candles chronologically.'];
  if (request.duplicateTimestampPolicy === 'KEEP_LAST') transformations.push('Resolved duplicate timestamps by retaining the last source row.');
  let candles: readonly Candle[];
  try { candles = normalizeCandles(rows, request.duplicateTimestampPolicy); } catch (error) {
    throw new Error(`Dataset import failed without repair: ${error instanceof Error ? error.message : 'unknown validation error'}`);
  }
  const validation = quality(rows, candles, request, transformations);
  const status: DatasetIntegrityStatus = !validation.valid ? 'INVALID' : request.sourceVerificationReference ? 'VERIFIED_SOURCE' : request.userProvided ? 'USER_PROVIDED' : 'UNVERIFIED';
  const sha256FileHash = createHash('sha256').update(request.bytes).digest('hex');
  const dataset: BacktestDataset = Object.freeze({ symbol: request.instrument, timeframe: request.timeframe, timezone: request.timezone, source: request.provider, candles, startTime: candles[0]!.timestamp, endTime: candles.at(-1)!.timestamp });
  const metadata: DatasetArtifactMetadata = Object.freeze({ instrument: request.instrument, provider: request.provider, providerSymbol: request.providerSymbol, timeframe: request.timeframe, timezone: request.timezone, pricePrecision: request.pricePrecision, datasetStart: dataset.startTime, datasetEnd: dataset.endTime, candleCount: candles.length, importTimestamp: request.importTimestamp, sourceFilename: request.sourceFilename, sha256FileHash, missingCandlePolicy: 'PRESERVE_AND_REPORT', duplicateTimestampPolicy: request.duplicateTimestampPolicy, priceRepresentation: request.priceRepresentation, status, sourceVerificationReference: request.sourceVerificationReference ?? null });
  return Object.freeze({ metadata, dataset, validation });
}
