import { filterCompletedCandles, SUPPORTED_TIMEFRAMES, validateCandles } from '../../analysis-utils/index.ts';
import type { DetectorResult, MarketDataSnapshot, NormalizedCandle, VolumeExpansionObservation } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import { calculateLegacyVolumeExpansion } from './volume-expansion-utils.ts';

export class VolumeExpansionDetector extends BaseDetector<VolumeExpansionObservation> {
  constructor() { super({ id: 'volume-expansion', version: '1.0.0', displayName: 'Volume Expansion Detector', deterministic: true, supportedTimeframes: [...SUPPORTED_TIMEFRAMES], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Compares the latest two completed candle volumes using the strict legacy 1.15 multiplier.' }); }
  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<VolumeExpansionObservation>> {
    if (!snapshot.timeframe.trim()) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Snapshot timeframe is missing.']);
    const validation = validateCandles(snapshot.candles);
    if (!validation.valid) return this.result(snapshot, 'ERROR', null, validation.issues.map((issue) => issue.message), validation.issues[0]?.code ?? 'INVALID_CANDLES');
    try {
      const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt);
      if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['One or more candle close timestamps are invalid.'], 'INVALID_TIMESTAMP');
      if (filtered.completed.length < 2) return this.result(snapshot, 'INSUFFICIENT_DATA', null, [`Volume expansion requires 2 completed candles; ${filtered.completed.length} available.`]);
      const source = filtered.completed.slice(-2), payload = calculateLegacyVolumeExpansion(snapshot.timeframe, source[0], source[1]);
      return this.result(snapshot, 'DETECTED', payload, payload.volumeAvailable ? [] : ['Volume is unavailable for one or both source candles; legacy classification remains not expanded.'], undefined, source, 1);
    } catch (error) { return this.result(snapshot, 'ERROR', null, [error instanceof Error ? error.message : 'Unexpected volume-expansion calculation failure.'], 'INTERNAL_CALCULATION_ERROR'); }
  }
  private result(snapshot: MarketDataSnapshot, status: DetectorResult<VolumeExpansionObservation>['status'], payload: VolumeExpansionObservation | null, warnings: string[], errorCode?: string, source: NormalizedCandle[] = [], confidence: number | null = null): DetectorResult<VolumeExpansionObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: snapshot.timeframe, observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status, confidence, payload, evidence: source.length && payload ? [{ id: `volume-expansion:${snapshot.timeframe}:${payload.eventCandleTime}`, type: 'VOLUME_SERIES', description: 'Expansion requires current volume to be strictly greater than previous volume × 1.15.', candleTimes: source.map((candle) => candle.openedAt), source: snapshot.provider, sourceReference: snapshot.id, metadata: { detectorVersion: this.version, timeframe: snapshot.timeframe, condition: 'currentVolume > previousVolume * 1.15', classification: payload.classification, volumeAvailable: payload.volumeAvailable } }] : [], freshness: snapshot.freshness, warnings, ...(errorCode ? { errorCode } : {}) };
  }
}
