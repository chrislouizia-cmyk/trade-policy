import { filterCompletedCandles, simpleAtr, SUPPORTED_TIMEFRAMES, validateCandles } from '../../analysis-utils/index.ts';
import type { DetectorResult, MarketDataSnapshot, NormalizedCandle, VolatilityRequirementObservation } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import { calculateLegacyVolatilityRequirement } from './volatility-requirement-utils.ts';

export class VolatilityRequirementDetector extends BaseDetector<VolatilityRequirementObservation> {
  constructor() { super({ id: 'volatility-requirement', version: '1.0.0', displayName: 'Volatility Requirement Detector', deterministic: true, supportedTimeframes: [...SUPPORTED_TIMEFRAMES], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Tests the latest completed candle range against the legacy ATR(14) × 0.8 requirement.' }); }
  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<VolatilityRequirementObservation>> {
    if (!snapshot.timeframe.trim()) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Snapshot timeframe is missing.']);
    const validation = validateCandles(snapshot.candles);
    if (!validation.valid) return this.result(snapshot, 'ERROR', null, validation.issues.map((issue) => issue.message), validation.issues[0]?.code ?? 'INVALID_CANDLES');
    try {
      const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt);
      if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['One or more candle close timestamps are invalid.'], 'INVALID_TIMESTAMP');
      if (filtered.completed.length < 15) return this.result(snapshot, 'INSUFFICIENT_DATA', null, [`Volatility requirement requires 15 completed candles for ATR(14); ${filtered.completed.length} available.`]);
      const source = filtered.completed.slice(-15), atr = simpleAtr(source, 14), payload = calculateLegacyVolatilityRequirement(snapshot.timeframe, source, atr);
      if (!payload) return this.result(snapshot, 'ERROR', null, ['Unexpected volatility-requirement calculation failure.'], 'INVALID_VOLATILITY_CALCULATION');
      return this.result(snapshot, 'DETECTED', payload, [], undefined, source, 1);
    } catch (error) { return this.result(snapshot, 'ERROR', null, [error instanceof Error ? error.message : 'Unexpected volatility-requirement calculation failure.'], 'INTERNAL_CALCULATION_ERROR'); }
  }
  private result(snapshot: MarketDataSnapshot, status: DetectorResult<VolatilityRequirementObservation>['status'], payload: VolatilityRequirementObservation | null, warnings: string[], errorCode?: string, source: NormalizedCandle[] = [], confidence: number | null = null): DetectorResult<VolatilityRequirementObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: snapshot.timeframe, observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status, confidence, payload, evidence: source.length && payload ? [{ id: `volatility-requirement:${snapshot.timeframe}:${payload.eventCandleTime}`, type: 'CANDLE_SERIES', description: 'Requirement needs ATR(14) > 0 and current range >= ATR(14) × 0.8.', candleTimes: source.map((candle) => candle.openedAt), priceLevels: [payload.open, payload.high, payload.low, payload.close, payload.volatilityThreshold], source: snapshot.provider, sourceReference: snapshot.id, metadata: { detectorVersion: this.version, timeframe: snapshot.timeframe, atrGuard: 'atr > 0', rangeCondition: 'currentRange >= atr * 0.8', classification: payload.classification } }] : [], freshness: snapshot.freshness, warnings, ...(errorCode ? { errorCode } : {}) };
  }
}
