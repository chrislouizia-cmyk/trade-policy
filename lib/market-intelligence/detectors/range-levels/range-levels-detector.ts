import { filterCompletedCandles, SUPPORTED_TIMEFRAMES, validateCandles } from '../../analysis-utils/index.ts';
import type { DetectorResult, MarketDataSnapshot, NormalizedCandle, RangeLevelsObservation } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import { calculateLegacyRangeLevels, RANGE_LEVELS_MINIMUM_CANDLES } from './range-levels-utils.ts';

export class RangeLevelsDetector extends BaseDetector<RangeLevelsObservation> {
  constructor() {
    super({ id: 'range-levels', version: '1.0.0', displayName: 'Range Levels Detector', deterministic: true, supportedTimeframes: [...SUPPORTED_TIMEFRAMES], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Preserves legacy rolling recent and previous high/low range levels.' });
  }

  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<RangeLevelsObservation>> {
    if (!snapshot.timeframe.trim()) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Snapshot timeframe is missing.']);
    const validation = validateCandles(snapshot.candles);
    if (!validation.valid) return this.result(snapshot, 'ERROR', null, validation.issues.map((issue) => issue.message), validation.issues[0]?.code ?? 'INVALID_CANDLES');
    const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt);
    if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['One or more candle close timestamps are invalid.'], 'INVALID_TIMESTAMP');
    const calculation = calculateLegacyRangeLevels(filtered.completed);
    if (!calculation) return this.result(snapshot, 'INSUFFICIENT_DATA', null, [`Range levels require ${RANGE_LEVELS_MINIMUM_CANDLES} completed candles; ${filtered.completed.length} available.`]);
    const { evidenceTimes: _evidenceTimes, ...values } = calculation;
    const payload: RangeLevelsObservation = { timeframe: snapshot.timeframe, ...values };
    return this.result(snapshot, 'DETECTED', payload, [], undefined, filtered.completed.slice(-RANGE_LEVELS_MINIMUM_CANDLES), 1);
  }

  private result(snapshot: MarketDataSnapshot, status: DetectorResult<RangeLevelsObservation>['status'], payload: RangeLevelsObservation | null, warnings: string[], errorCode?: string, source: NormalizedCandle[] = [], confidence: number | null = null): DetectorResult<RangeLevelsObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: snapshot.timeframe, observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status, confidence, payload, evidence: source.length && payload ? [{ id: `range-levels:${snapshot.timeframe}:${source[0].openedAt}:${source.at(-1)!.openedAt}`, type: 'CANDLE_SERIES', description: 'Recent levels use the seven candles before the latest candle; previous levels use the preceding twelve candles.', candleTimes: source.map((candle) => candle.openedAt), priceLevels: [payload.recentHigh, payload.recentLow, payload.previousHigh, payload.previousLow, payload.midpoint], source: snapshot.provider, sourceReference: snapshot.id, metadata: { detectorVersion: this.version, timeframe: snapshot.timeframe, recentWindowSize: 7, previousWindowSize: 12 } }] : [], freshness: snapshot.freshness, warnings, ...(errorCode ? { errorCode } : {}) };
  }
}
