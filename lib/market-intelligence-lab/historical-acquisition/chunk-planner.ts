import { timeframeDurationMs } from '../../market-intelligence/analysis-utils/timeframes.ts';
import { stableFingerprint } from '../../market-intelligence/serialization/stable-fingerprint.ts';
import type { AcquisitionChunk, HistoricalAcquisitionRequest } from './acquisition-types.ts';
import { HistoricalAcquisitionError } from './acquisition-types.ts';

const TARGET_POINTS = 4_500;
export function planAcquisitionChunks(request: HistoricalAcquisitionRequest): readonly AcquisitionChunk[] {
  const start = Date.parse(request.startAt), end = Date.parse(request.endAt), interval = timeframeDurationMs(request.timeframe);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || interval === null || request.timezone !== 'UTC') throw new HistoricalAcquisitionError('INVALID_REQUEST', 'Acquisition requires a valid increasing UTC range and supported timeframe.');
  const span = interval * TARGET_POINTS, chunks: AcquisitionChunk[] = [];
  for (let cursor = start; cursor < end;) { const next = Math.min(end, cursor + span); const startAt = new Date(cursor).toISOString(), endAt = new Date(next).toISOString(); chunks.push(Object.freeze({ chunkId: `chunk:${stableFingerprint({ request, startAt, endAt })}`, startAt, endAt })); cursor = next; }
  return Object.freeze(chunks);
}
