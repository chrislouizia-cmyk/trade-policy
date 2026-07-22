import type { NormalizedCandle } from '../../market-intelligence/contracts.ts';

export type AcquisitionTimeframe = 'M5' | 'M15' | 'H1';
export type HistoricalAcquisitionRequest = { instrument: 'XAUUSD'; timeframe: AcquisitionTimeframe; startAt: string; endAt: string; acquiredAt: string; provider: 'Twelve Data'; timezone: 'UTC' };
export type AcquisitionChunk = { chunkId: string; startAt: string; endAt: string };
export type AcquisitionProvenance = { provider: 'Twelve Data'; providerSymbol: 'XAU/USD'; timezone: 'UTC'; timestampConvention: 'BAR_OPEN_UTC'; requestedStartAt: string; requestedEndAt: string; acquiredAt: string; chunkCount: number; requestFingerprint: string; maximumPointsPerRequest: 5000; };
export type HistoricalAcquisitionResult = { request: HistoricalAcquisitionRequest; candles: readonly NormalizedCandle[]; chunks: readonly AcquisitionChunk[]; provenance: AcquisitionProvenance; warnings: readonly string[] };
export class HistoricalAcquisitionError extends Error { readonly code: 'INVALID_REQUEST' | 'PROVIDER_ERROR' | 'NO_DATA' | 'TOO_MANY_POINTS' | 'INVALID_RESPONSE' | 'INCOMPLETE_COVERAGE'; constructor(code: HistoricalAcquisitionError['code'], message: string) { super(message); this.name = 'HistoricalAcquisitionError'; this.code = code; } }
