import { filterCompletedCandles, LEGACY_PRIOR_STRUCTURE_MINIMUM_CANDLES, resolveLegacyPriorStructuralWindow, SUPPORTED_TIMEFRAMES, validateCandles } from '../../analysis-utils/index.ts';
import type { DetectorResult, LiquiditySweepObservation, MarketDataSnapshot, NormalizedCandle } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import { calculateLiquiditySweep } from './liquidity-sweep-utils.ts';

export class LiquiditySweepDetector extends BaseDetector<LiquiditySweepObservation> {
  constructor() { super({ id: 'liquidity-sweep', version: '1.0.0', displayName: 'Liquidity Sweep Detector', deterministic: true, supportedTimeframes: [...SUPPORTED_TIMEFRAMES], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Classifies strict legacy wick-through and close-back-inside liquidity sweeps.' }); }

  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<LiquiditySweepObservation>> {
    if (!snapshot.timeframe.trim()) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Snapshot timeframe is missing.']);
    const validation = validateCandles(snapshot.candles);
    if (!validation.valid) return this.result(snapshot, 'ERROR', null, validation.issues.map((issue) => issue.message), validation.issues[0]?.code ?? 'INVALID_CANDLES');
    try {
      const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt);
      if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['One or more candle close timestamps are invalid.'], 'INVALID_TIMESTAMP');
      const window = resolveLegacyPriorStructuralWindow(filtered.completed);
      if (!window) return this.result(snapshot, 'INSUFFICIENT_DATA', null, [`Liquidity sweep requires ${LEGACY_PRIOR_STRUCTURE_MINIMUM_CANDLES} completed candles; ${filtered.completed.length} available.`]);
      const payload = calculateLiquiditySweep(snapshot.timeframe, window); const source = [...window.referenceCandles, window.eventCandle];
      return this.result(snapshot, 'DETECTED', payload, [], undefined, source, 1);
    } catch (error) {
      return this.result(snapshot, 'ERROR', null, [error instanceof Error ? error.message : 'Unexpected liquidity-sweep calculation failure.'], 'INTERNAL_CALCULATION_ERROR');
    }
  }

  private result(snapshot: MarketDataSnapshot, status: DetectorResult<LiquiditySweepObservation>['status'], payload: LiquiditySweepObservation | null, warnings: string[], errorCode?: string, source: NormalizedCandle[] = [], confidence: number | null = null): DetectorResult<LiquiditySweepObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: snapshot.timeframe, observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status, confidence, payload, evidence: source.length && payload ? [{ id: `liquidity-sweep:${snapshot.timeframe}:${payload.eventCandleTime}`, type: 'STRUCTURAL_EVENT', description: `Sweep ${payload.side}: high-side requires high > prior high and close < prior high; low-side requires low < prior low and close > prior low.`, candleTimes: source.map((candle) => candle.openedAt), priceLevels: [payload.referenceHigh, payload.referenceLow, payload.currentOpen, payload.currentHigh, payload.currentLow, payload.currentClose], source: snapshot.provider, sourceReference: snapshot.id, metadata: { timeframe: snapshot.timeframe, detectorVersion: this.version, referenceWindowTimes: source.slice(0, -1).map((candle) => candle.openedAt), eventCandleTime: payload.eventCandleTime, referenceHigh: payload.referenceHigh, referenceLow: payload.referenceLow, currentCandle: { open: payload.currentOpen, high: payload.currentHigh, low: payload.currentLow, close: payload.currentClose }, highSideCondition: 'currentHigh > referenceHigh && currentClose < referenceHigh', lowSideCondition: 'currentLow < referenceLow && currentClose > referenceLow', classification: payload.side } }] : [], freshness: snapshot.freshness, warnings, ...(errorCode ? { errorCode } : {}) };
  }
}
