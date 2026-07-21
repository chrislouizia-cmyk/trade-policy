import { filterCompletedCandles, SUPPORTED_TIMEFRAMES, validateCandles } from '../../analysis-utils/index.ts';
import type { DetectorResult, FairValueGapObservation, MarketDataSnapshot, NormalizedCandle } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import { calculateLegacyFairValueGap } from './fair-value-gap-utils.ts';

export class FairValueGapDetector extends BaseDetector<FairValueGapObservation> {
  constructor() { super({ id: 'fair-value-gap', version: '1.0.0', displayName: 'Fair Value Gap Detector', deterministic: true, supportedTimeframes: [...SUPPORTED_TIMEFRAMES], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Classifies only the latest strict legacy three-candle fair value gap.' }); }
  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<FairValueGapObservation>> {
    if (!snapshot.timeframe.trim()) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Snapshot timeframe is missing.']);
    const validation = validateCandles(snapshot.candles);
    if (!validation.valid) return this.result(snapshot, 'ERROR', null, validation.issues.map((issue) => issue.message), validation.issues[0]?.code ?? 'INVALID_CANDLES');
    try {
      const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt);
      if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['One or more candle close timestamps are invalid.'], 'INVALID_TIMESTAMP');
      if (filtered.completed.length < 3) return this.result(snapshot, 'INSUFFICIENT_DATA', null, [`Fair value gap requires 3 completed candles; ${filtered.completed.length} available.`]);
      const source = filtered.completed.slice(-3), payload = calculateLegacyFairValueGap(snapshot.timeframe, source);
      if (!payload) return this.result(snapshot, 'ERROR', null, ['Unexpected fair-value-gap source window.'], 'INVALID_SOURCE_WINDOW');
      return this.result(snapshot, 'DETECTED', payload, [], undefined, source, 1);
    } catch (error) { return this.result(snapshot, 'ERROR', null, [error instanceof Error ? error.message : 'Unexpected fair-value-gap calculation failure.'], 'INTERNAL_CALCULATION_ERROR'); }
  }
  private result(snapshot: MarketDataSnapshot, status: DetectorResult<FairValueGapObservation>['status'], payload: FairValueGapObservation | null, warnings: string[], errorCode?: string, source: NormalizedCandle[] = [], confidence: number | null = null): DetectorResult<FairValueGapObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: snapshot.timeframe, observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status, confidence, payload, evidence: source.length && payload ? [{ id: `fair-value-gap:${snapshot.timeframe}:${payload.eventCandleTime}`, type: 'CANDLE_PATTERN', description: `FVG ${payload.direction}: bullish requires current low > reference high; bearish requires current high < reference low.`, candleTimes: source.map((candle) => candle.openedAt), priceLevels: [payload.referenceCandle.high, payload.referenceCandle.low, payload.currentCandle.high, payload.currentCandle.low], source: snapshot.provider, sourceReference: snapshot.id, metadata: { detectorVersion: this.version, timeframe: snapshot.timeframe, bullishCondition: 'currentLow > referenceHigh', bearishCondition: 'currentHigh < referenceLow', classification: payload.direction } }] : [], freshness: snapshot.freshness, warnings, ...(errorCode ? { errorCode } : {}) };
  }
}
