import { filterCompletedCandles, resolveLegacyStructuralWindow, STRUCTURAL_MINIMUM_CANDLES, SUPPORTED_TIMEFRAMES, validateCandles } from '../../analysis-utils/index.ts';
import type { BreakOfStructureObservation, DetectorResult, MarketDataSnapshot, NormalizedCandle } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import { calculateBreakOfStructure } from './break-of-structure-utils.ts';

export class BreakOfStructureDetector extends BaseDetector<BreakOfStructureObservation> {
  constructor() { super({ id: 'break-of-structure', version: '1.0.0', displayName: 'Break of Structure Detector', deterministic: true, supportedTimeframes: [...SUPPORTED_TIMEFRAMES], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Classifies close-based structural breaks using the legacy seven-candle reference window.' }); }

  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<BreakOfStructureObservation>> {
    if (!snapshot.timeframe.trim()) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Snapshot timeframe is missing.']);
    const validation = validateCandles(snapshot.candles);
    if (!validation.valid) return this.result(snapshot, 'ERROR', null, validation.issues.map((issue) => issue.message), validation.issues[0]?.code ?? 'INVALID_CANDLES');
    try {
      const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt);
      if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['One or more candle close timestamps are invalid.'], 'INVALID_TIMESTAMP');
      const window = resolveLegacyStructuralWindow(filtered.completed);
      if (!window) return this.result(snapshot, 'INSUFFICIENT_DATA', null, [`Break of structure requires ${STRUCTURAL_MINIMUM_CANDLES} completed candles; ${filtered.completed.length} available.`]);
      const payload = calculateBreakOfStructure(snapshot.timeframe, window); const source = [...window.referenceCandles, window.eventCandle];
      return this.result(snapshot, 'DETECTED', payload, [], undefined, source, 1);
    } catch (error) {
      return this.result(snapshot, 'ERROR', null, [error instanceof Error ? error.message : 'Unexpected break-of-structure calculation failure.'], 'INTERNAL_CALCULATION_ERROR');
    }
  }

  private result(snapshot: MarketDataSnapshot, status: DetectorResult<BreakOfStructureObservation>['status'], payload: BreakOfStructureObservation | null, warnings: string[], errorCode?: string, source: NormalizedCandle[] = [], confidence: number | null = null): DetectorResult<BreakOfStructureObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: snapshot.timeframe, observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status, confidence, payload, evidence: source.length && payload ? [{ id: `break-of-structure:${snapshot.timeframe}:${payload.eventCandleTime}`, type: 'STRUCTURAL_EVENT', description: `BOS ${payload.direction}: bullish requires current close > reference high; bearish requires current close < reference low; otherwise none.`, candleTimes: source.map((candle) => candle.openedAt), priceLevels: [payload.referenceHigh, payload.referenceLow, payload.currentOpen, payload.currentHigh, payload.currentLow, payload.currentClose], source: snapshot.provider, sourceReference: snapshot.id, metadata: { timeframe: snapshot.timeframe, detectorVersion: this.version, referenceWindowTimes: source.slice(0, -1).map((candle) => candle.openedAt), eventCandleTime: payload.eventCandleTime, referenceHigh: payload.referenceHigh, referenceLow: payload.referenceLow, currentCandle: { open: payload.currentOpen, high: payload.currentHigh, low: payload.currentLow, close: payload.currentClose }, bullishCondition: 'currentClose > referenceHigh', bearishCondition: 'currentClose < referenceLow', classification: payload.direction } }] : [], freshness: snapshot.freshness, warnings, ...(errorCode ? { errorCode } : {}) };
  }
}
