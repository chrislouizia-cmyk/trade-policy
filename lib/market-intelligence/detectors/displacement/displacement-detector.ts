import { filterCompletedCandles, simpleAtr, SUPPORTED_TIMEFRAMES, validateCandles } from '../../analysis-utils/index.ts';
import type { DetectorResult, DisplacementObservation, MarketDataSnapshot, NormalizedCandle } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import { calculateLegacyDisplacement } from './displacement-utils.ts';

export class DisplacementDetector extends BaseDetector<DisplacementObservation> {
  constructor() { super({ id: 'displacement', version: '1.0.0', displayName: 'Displacement Detector', deterministic: true, supportedTimeframes: [...SUPPORTED_TIMEFRAMES], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Classifies latest-candle body magnitude against legacy ATR and range thresholds.' }); }
  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<DisplacementObservation>> {
    if (!snapshot.timeframe.trim()) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Snapshot timeframe is missing.']);
    const validation = validateCandles(snapshot.candles);
    if (!validation.valid) return this.result(snapshot, 'ERROR', null, validation.issues.map((issue) => issue.message), validation.issues[0]?.code ?? 'INVALID_CANDLES');
    try {
      const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt);
      if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['One or more candle close timestamps are invalid.'], 'INVALID_TIMESTAMP');
      if (filtered.completed.length < 15) return this.result(snapshot, 'INSUFFICIENT_DATA', null, [`Displacement requires 15 completed candles for ATR(14); ${filtered.completed.length} available.`]);
      const source = filtered.completed.slice(-15), atr = simpleAtr(source, 14), payload = calculateLegacyDisplacement(snapshot.timeframe, source, atr);
      if (!payload) return this.result(snapshot, 'ERROR', null, ['Unexpected displacement calculation failure.'], 'INVALID_DISPLACEMENT_CALCULATION');
      return this.result(snapshot, 'DETECTED', payload, [], undefined, source, 1);
    } catch (error) { return this.result(snapshot, 'ERROR', null, [error instanceof Error ? error.message : 'Unexpected displacement calculation failure.'], 'INTERNAL_CALCULATION_ERROR'); }
  }
  private result(snapshot: MarketDataSnapshot, status: DetectorResult<DisplacementObservation>['status'], payload: DisplacementObservation | null, warnings: string[], errorCode?: string, source: NormalizedCandle[] = [], confidence: number | null = null): DetectorResult<DisplacementObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: snapshot.timeframe, observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status, confidence, payload, evidence: source.length && payload ? [{ id: `displacement:${snapshot.timeframe}:${payload.eventCandleTime}`, type: 'CANDLE_PATTERN', description: 'Displacement requires body > max(ATR(14) × 1.1, full range × 0.65).', candleTimes: source.map((candle) => candle.openedAt), priceLevels: [payload.open, payload.high, payload.low, payload.close, payload.effectiveThreshold], source: snapshot.provider, sourceReference: snapshot.id, metadata: { detectorVersion: this.version, timeframe: snapshot.timeframe, atrCondition: 'bodySize > atr * 1.1', rangeCondition: 'bodySize > fullRange * 0.65', classification: payload.classification } }] : [], freshness: snapshot.freshness, warnings, ...(errorCode ? { errorCode } : {}) };
  }
}
