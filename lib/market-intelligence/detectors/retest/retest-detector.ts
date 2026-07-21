import { filterCompletedCandles, SUPPORTED_TIMEFRAMES, validateCandles } from '../../analysis-utils/index.ts';
import type { DetectorResult, MarketDataSnapshot, NormalizedCandle, RetestObservation } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import { calculateLegacyRetest } from './retest-utils.ts';

export class RetestDetector extends BaseDetector<RetestObservation> {
  constructor() { super({ id: 'retest', version: '1.0.0', displayName: 'Retest Detector', deterministic: true, supportedTimeframes: [...SUPPORTED_TIMEFRAMES], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Tests latest-close proximity to the legacy bias-selected recent range level.' }); }
  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<RetestObservation>> {
    if (!snapshot.timeframe.trim()) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Snapshot timeframe is missing.']);
    const validation = validateCandles(snapshot.candles);
    if (!validation.valid) return this.result(snapshot, 'ERROR', null, validation.issues.map((issue) => issue.message), validation.issues[0]?.code ?? 'INVALID_CANDLES');
    try {
      const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt);
      if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['One or more candle close timestamps are invalid.'], 'INVALID_TIMESTAMP');
      if (filtered.completed.length < 24) return this.result(snapshot, 'INSUFFICIENT_DATA', null, [`Retest requires 24 completed candles; ${filtered.completed.length} available.`]);
      const source = filtered.completed.slice(-24), payload = calculateLegacyRetest(snapshot.timeframe, source);
      if (!payload) return this.result(snapshot, 'ERROR', null, ['Unexpected retest calculation failure.'], 'INVALID_RETEST_CALCULATION');
      return this.result(snapshot, 'DETECTED', payload, [], undefined, source, 1);
    } catch (error) { return this.result(snapshot, 'ERROR', null, [error instanceof Error ? error.message : 'Unexpected retest calculation failure.'], 'INTERNAL_CALCULATION_ERROR'); }
  }
  private result(snapshot: MarketDataSnapshot, status: DetectorResult<RetestObservation>['status'], payload: RetestObservation | null, warnings: string[], errorCode?: string, source: NormalizedCandle[] = [], confidence: number | null = null): DetectorResult<RetestObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: snapshot.timeframe, observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status, confidence, payload, evidence: source.length && payload ? [{ id: `retest:${snapshot.timeframe}:${payload.eventCandleTime}`, type: 'STRUCTURAL_EVENT', description: 'Retest requires absolute close-to-target distance <= max(ATR × 0.35, close × 0.0002).', candleTimes: source.map((candle) => candle.openedAt), priceLevels: [payload.currentClose, payload.targetLevel, payload.recentHigh, payload.recentLow], source: snapshot.provider, sourceReference: snapshot.id, metadata: { detectorVersion: this.version, timeframe: snapshot.timeframe, trendBias: payload.trendBias, targetRule: "BULLISH uses recentHigh; BEARISH and RANGE use recentLow", condition: 'distanceToTarget <= tolerance', classification: payload.classification } }] : [], freshness: snapshot.freshness, warnings, ...(errorCode ? { errorCode } : {}) };
  }
}
