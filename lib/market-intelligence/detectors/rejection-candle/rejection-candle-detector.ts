import { filterCompletedCandles, SUPPORTED_TIMEFRAMES, validateCandles } from '../../analysis-utils/index.ts';
import type { DetectorResult, MarketDataSnapshot, NormalizedCandle, RejectionCandleObservation } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import { calculateLegacyRejectionCandle } from './rejection-candle-utils.ts';

export class RejectionCandleDetector extends BaseDetector<RejectionCandleObservation> {
  constructor() { super({ id: 'rejection-candle', version: '1.0.0', displayName: 'Rejection Candle Detector', deterministic: true, supportedTimeframes: [...SUPPORTED_TIMEFRAMES], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Classifies the latest completed candle using the strict legacy wick-to-body threshold.' }); }
  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<RejectionCandleObservation>> {
    if (!snapshot.timeframe.trim()) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Snapshot timeframe is missing.']);
    const validation = validateCandles(snapshot.candles);
    if (!validation.valid) return this.result(snapshot, 'ERROR', null, validation.issues.map((issue) => issue.message), validation.issues[0]?.code ?? 'INVALID_CANDLES');
    try {
      const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt);
      if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['One or more candle close timestamps are invalid.'], 'INVALID_TIMESTAMP');
      const candle = filtered.completed.at(-1);
      if (!candle) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Rejection candle requires 1 completed candle; 0 available.']);
      const payload = calculateLegacyRejectionCandle(snapshot.timeframe, candle);
      if (!payload) return this.result(snapshot, 'ERROR', null, ['Unexpected rejection-candle geometry failure.'], 'INVALID_CANDLE_GEOMETRY');
      return this.result(snapshot, 'DETECTED', payload, [], undefined, [candle], 1);
    } catch (error) { return this.result(snapshot, 'ERROR', null, [error instanceof Error ? error.message : 'Unexpected rejection-candle calculation failure.'], 'INTERNAL_CALCULATION_ERROR'); }
  }
  private result(snapshot: MarketDataSnapshot, status: DetectorResult<RejectionCandleObservation>['status'], payload: RejectionCandleObservation | null, warnings: string[], errorCode?: string, source: NormalizedCandle[] = [], confidence: number | null = null): DetectorResult<RejectionCandleObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: snapshot.timeframe, observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status, confidence, payload, evidence: source.length && payload ? [{ id: `rejection-candle:${snapshot.timeframe}:${payload.eventCandleTime}`, type: 'CANDLE_PATTERN', description: `Rejection ${payload.classification}: each wick qualifies only when strictly greater than body size × 1.5.`, candleTimes: [payload.eventCandleTime], priceLevels: [payload.open, payload.high, payload.low, payload.close], source: snapshot.provider, sourceReference: snapshot.id, metadata: { detectorVersion: this.version, timeframe: snapshot.timeframe, upperCondition: 'upperWick > bodySize * 1.5', lowerCondition: 'lowerWick > bodySize * 1.5', classification: payload.classification } }] : [], freshness: snapshot.freshness, warnings, ...(errorCode ? { errorCode } : {}) };
  }
}
