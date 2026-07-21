import { filterCompletedCandles, simpleAtr, SUPPORTED_TIMEFRAMES, validateCandles } from '../../analysis-utils/index.ts';
import type { AtrObservation, DetectorResult, MarketDataSnapshot, NormalizedCandle } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import type { AtrDetectorOptions } from './atr-types.ts';

export class AtrDetector extends BaseDetector<AtrObservation> {
  readonly #period: number;

  constructor(options: AtrDetectorOptions = {}) {
    super({ id: 'atr', version: '1.0.0', displayName: 'ATR Detector', deterministic: true, supportedTimeframes: [...SUPPORTED_TIMEFRAMES], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Calculates simple average true range from completed normalized candles.' });
    this.#period = options.period ?? 14;
  }

  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<AtrObservation>> {
    const validation = validateCandles(snapshot.candles);
    if (!validation.valid) return this.result(snapshot, 'ERROR', null, validation.issues.map((issue) => issue.message), validation.issues[0]?.code ?? 'INVALID_CANDLES');
    const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt);
    if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['One or more candle close timestamps are invalid.'], 'INVALID_TIMESTAMP');
    const calculation = simpleAtr(filtered.completed, this.#period);
    if (!calculation.sufficientData || calculation.value === null || calculation.sourceStartTime === null || calculation.sourceEndTime === null) {
      return this.result(snapshot, 'INSUFFICIENT_DATA', null, [`ATR(${this.#period}) requires ${this.#period + 1} completed candles; ${filtered.completed.length} available.`]);
    }
    const source = filtered.completed.slice(-(this.#period + 1)); const latest = source.at(-1)!;
    const payload: AtrObservation = { timeframe: snapshot.timeframe, atr: calculation.value, period: calculation.period, smoothingMethod: calculation.smoothingMethod, candleCount: calculation.candleCount, trueRangeCount: calculation.trueRangeCount, unit: 'RAW_PRICE', normalizedAtrPercent: latest.close === 0 ? null : calculation.value / latest.close * 100, sourceStartTime: calculation.sourceStartTime, sourceEndTime: calculation.sourceEndTime, lastCandleTime: latest.openedAt };
    return this.result(snapshot, 'DETECTED', payload, [], undefined, source);
  }

  private result(snapshot: MarketDataSnapshot, status: DetectorResult<AtrObservation>['status'], payload: AtrObservation | null, warnings: string[], errorCode?: string, source: NormalizedCandle[] = []): DetectorResult<AtrObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: snapshot.timeframe, observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status, confidence: status === 'DETECTED' ? 100 : null, payload, evidence: source.length ? [{ id: `atr:${snapshot.timeframe}:${source[0].openedAt}:${source.at(-1)!.openedAt}`, type: 'CANDLE_SERIES', description: `ATR(${this.#period}) calculated from ${source.length} completed candles using SIMPLE smoothing.`, candleTimes: source.map((candle) => candle.openedAt), source: snapshot.provider, sourceReference: snapshot.id }] : [], freshness: snapshot.freshness, warnings, ...(errorCode ? { errorCode } : {}) };
  }
}
