import type { DetectorResult, MarketDataSnapshot } from '../contracts.ts';
import { BaseDetector } from './base-detector.ts';

export class PlaceholderDetector extends BaseDetector {
  constructor() {
    super({
      id: 'infrastructure.placeholder',
      version: '1.0.0',
      displayName: 'Placeholder Detector',
      deterministic: true,
      supportedTimeframes: [],
      supportsReplay: true,
      experimental: true,
      enabledByDefault: false,
      description: 'Infrastructure-only detector that performs no market analysis.',
    });
  }

  async execute(snapshot: MarketDataSnapshot): Promise<DetectorResult> {
    const observedAt = new Date().toISOString();
    return {
      detectorId: this.id,
      detectorVersion: this.version,
      runId: 'unassigned',
      instrument: snapshot.instrument,
      timeframe: snapshot.timeframe,
      observedAt,
      dataAsOf: snapshot.dataAsOf,
      status: 'INSUFFICIENT_DATA',
      confidence: null,
      payload: null,
      evidence: [],
      freshness: snapshot.freshness,
      warnings: ['Placeholder detector'],
    };
  }
}
