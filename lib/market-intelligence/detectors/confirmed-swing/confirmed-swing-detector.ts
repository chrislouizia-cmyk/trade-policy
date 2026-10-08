import { filterCompletedCandles, SUPPORTED_TIMEFRAMES } from '../../analysis-utils/index.ts';
import type { DetectorResult, MarketDataSnapshot } from '../../contracts.ts';
import { BaseDetector } from '../base-detector.ts';
import type { SwingDetectionResult, SwingDetectorConfig } from './confirmed-swing-types.ts';
import { detectConfirmedSwings, SwingDetectionError } from './confirmed-swing-utils.ts';

export class ConfirmedSwingDetector extends BaseDetector<SwingDetectionResult> {
  readonly #configuration: Partial<SwingDetectorConfig>;

  constructor(configuration: Partial<SwingDetectorConfig> = {}) {
    super({
      id: 'confirmed-swing',
      version: '1.0.0',
      displayName: 'Confirmed Swing Detector',
      deterministic: true,
      supportedTimeframes: [...SUPPORTED_TIMEFRAMES],
      supportsReplay: true,
      experimental: true,
      enabledByDefault: false,
      description: 'Detects strict, right-confirmed swing highs and lows with replay-safe first-known timestamps.',
    });
    this.#configuration = Object.freeze({ ...configuration, context: configuration.context ? Object.freeze({ ...configuration.context }) : undefined });
  }

  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<SwingDetectionResult>> {
    const filtered = filterCompletedCandles(snapshot.candles, snapshot.requestedAt);
    if (filtered.invalidTimestamp.length) return this.result(snapshot, 'ERROR', null, ['Candle close timestamps must be valid.'], 'INVALID_TIMESTAMP');
    try {
      const payload = detectConfirmedSwings(filtered.completed, {
        ...this.#configuration,
        context: {
          instrument: snapshot.instrument,
          timeframe: snapshot.timeframe,
          datasetId: snapshot.id,
          ...this.#configuration.context,
        },
      });
      const minimum = payload.configuration.leftBars + payload.configuration.rightBars + 1;
      if (filtered.completed.length < minimum) return this.result(snapshot, 'INSUFFICIENT_DATA', null, [`Confirmed swings require at least ${minimum} completed candles.`], 'INSUFFICIENT_HISTORY');
      return this.result(snapshot, payload.swings.length ? 'DETECTED' : 'NOT_DETECTED', payload, payload.warnings);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected confirmed-swing calculation failure.';
      return this.result(snapshot, 'ERROR', null, [message], error instanceof SwingDetectionError ? error.code : 'INTERNAL_CALCULATION_ERROR');
    }
  }

  private result(snapshot: MarketDataSnapshot, status: DetectorResult<SwingDetectionResult>['status'], payload: SwingDetectionResult | null, warnings: string[], errorCode?: string): DetectorResult<SwingDetectionResult> {
    return {
      detectorId: this.id,
      detectorVersion: this.version,
      runId: 'unassigned',
      instrument: snapshot.instrument,
      timeframe: snapshot.timeframe,
      observedAt: snapshot.dataAsOf,
      dataAsOf: snapshot.dataAsOf,
      status,
      confidence: payload ? 1 : null,
      payload,
      evidence: payload?.swings.map((swing) => ({
        id: swing.id,
        type: 'CONFIRMED_SWING',
        description: `${swing.direction} pivot at ${swing.pivotAt}; first known at ${swing.confirmedAt}.`,
        candleTimes: [swing.pivotAt, swing.confirmedAt],
        priceLevels: [swing.price],
        source: snapshot.provider,
        sourceReference: snapshot.id,
        metadata: { direction: swing.direction, pivotIndex: swing.pivotIndex, confirmedIndex: swing.confirmedIndex, prominence: swing.prominence, strength: swing.strength },
      })) ?? [],
      freshness: snapshot.freshness,
      warnings,
      ...(errorCode ? { errorCode } : {}),
    };
  }
}
