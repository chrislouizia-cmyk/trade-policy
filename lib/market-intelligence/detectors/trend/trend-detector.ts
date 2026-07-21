import { filterCompletedCandles, simpleMovingAverage, SUPPORTED_TIMEFRAMES, validateCandles } from '../../analysis-utils/index.ts';
import type { DetectorResult, MarketDataSnapshot, NormalizedCandle, TrendObservation } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import { calculateTrendStrength, classifyLegacyTrend } from './trend-utils.ts';

export class TrendDetector extends BaseDetector<TrendObservation> {
  readonly #fastPeriod: number;
  readonly #slowPeriod: number;

  constructor() {
    super({ id: 'trend', version: '1.0.0', displayName: 'Trend Detector', deterministic: true, supportedTimeframes: [...SUPPORTED_TIMEFRAMES], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Preserves the legacy SMA(10)/SMA(24) close-based trend classification.' });
    this.#fastPeriod = 10;
    this.#slowPeriod = 24;
  }

  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<TrendObservation>> {
    if (!snapshot.timeframe.trim()) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Snapshot timeframe is missing.']);
    const validation = validateCandles(snapshot.candles);
    if (!validation.valid) return this.result(snapshot, 'ERROR', null, validation.issues.map((issue) => issue.message), validation.issues[0]?.code ?? 'INVALID_CANDLES');
    const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt);
    if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['One or more candle close timestamps are invalid.'], 'INVALID_TIMESTAMP');
    if (filtered.completed.length < this.#slowPeriod) return this.result(snapshot, 'INSUFFICIENT_DATA', null, [`Trend detection requires ${this.#slowPeriod} completed candles; ${filtered.completed.length} available.`]);

    const closes = filtered.completed.map((candle) => candle.close);
    const fast = simpleMovingAverage(closes, this.#fastPeriod, 'close');
    const slow = simpleMovingAverage(closes, this.#slowPeriod, 'close');
    if (!fast.sufficientData || !slow.sufficientData || fast.value === null || slow.value === null) return this.result(snapshot, 'INSUFFICIENT_DATA', null, ['Trend moving-average history is insufficient.']);

    const last = filtered.completed.at(-1)!;
    const direction = classifyLegacyTrend(fast.value, slow.value, last.close);
    const strength = calculateTrendStrength(fast.value, slow.value, last.close);
    const source = filtered.completed.slice(-this.#slowPeriod);
    const payload: TrendObservation = { timeframe: snapshot.timeframe, direction, latestClose: last.close, fastAverage: { type: 'SMA', period: 10, value: fast.value }, slowAverage: { type: 'SMA', period: 24, value: slow.value }, fastSlowDifference: strength.fastSlowDifference, fastSlowDifferencePercent: strength.fastSlowDifferencePercent, closeToSlowDifference: strength.closeToSlowDifference, closeToSlowDifferencePercent: strength.closeToSlowDifferencePercent, candleCount: source.length, sourceStartTime: source[0].openedAt, sourceEndTime: source.at(-1)!.openedAt, lastCandleTime: last.openedAt };
    return this.result(snapshot, 'DETECTED', payload, [], undefined, source, strength.confidence);
  }

  private result(snapshot: MarketDataSnapshot, status: DetectorResult<TrendObservation>['status'], payload: TrendObservation | null, warnings: string[], errorCode?: string, source: NormalizedCandle[] = [], confidence: number | null = null): DetectorResult<TrendObservation> {
    return { detectorId: this.id, detectorVersion: this.version, runId: 'unassigned', instrument: snapshot.instrument, timeframe: snapshot.timeframe, observedAt: snapshot.dataAsOf, dataAsOf: snapshot.dataAsOf, status, confidence, payload, evidence: source.length && payload ? [{ id: `trend:${snapshot.timeframe}:${source[0].openedAt}:${source.at(-1)!.openedAt}`, type: 'CANDLE_SERIES', description: `Trend classified as ${payload.direction}: bullish requires fast SMA > slow SMA and latest close > slow SMA; bearish requires both comparisons below; otherwise range.`, candleTimes: source.map((candle) => candle.openedAt), priceLevels: [payload.latestClose, payload.fastAverage.value, payload.slowAverage.value], source: snapshot.provider, sourceReference: snapshot.id, metadata: { timeframe: snapshot.timeframe, detectorVersion: this.version, latestClose: payload.latestClose, fastAverage: payload.fastAverage, slowAverage: payload.slowAverage, classification: payload.direction } }] : [], freshness: snapshot.freshness, warnings, ...(errorCode ? { errorCode } : {}) };
  }
}
