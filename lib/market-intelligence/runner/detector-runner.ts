import type { DetectorResult, MarketDataSnapshot } from '../contracts.ts';
import type { DetectorRegistry } from '../registry/detector-registry.ts';
import type { DetectorFailure, DetectorRunSummary } from '../types/detector.ts';
import { stableFingerprint } from '../serialization/stable-fingerprint.ts';

type DetectorRunnerOptions = {
  now?: () => number;
  createRunId?: (snapshot: MarketDataSnapshot, detectorIds: readonly string[]) => string;
};

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Unknown detector failure.';
}

export class DetectorRunner {
  readonly #registry: DetectorRegistry;
  readonly #now?: () => number;
  readonly #createRunId: (snapshot: MarketDataSnapshot, detectorIds: readonly string[]) => string;

  constructor(registry: DetectorRegistry, options: DetectorRunnerOptions = {}) {
    this.#registry = registry;
    this.#now = options.now;
    this.#createRunId = options.createRunId ?? ((snapshot, detectorIds) => `detector-run:${stableFingerprint({ snapshotId: snapshot.id, detectorIds })}`);
  }

  async execute(snapshot: MarketDataSnapshot, detectorIds: readonly string[]): Promise<DetectorRunSummary> {
    const requestedMs = Date.parse(snapshot.requestedAt);
    const startedMs = this.#now?.() ?? requestedMs;
    const startedAt = new Date(startedMs).toISOString();
    const runId = this.#createRunId(snapshot, detectorIds);
    const detectors = detectorIds.map((detectorId) => ({ detectorId, detector: this.#registry.get(detectorId) }));
    const settled = await Promise.allSettled(detectors.map(async ({ detector, detectorId }) => {
      if (!detector) throw new Error(`Detector is not registered: ${detectorId}`);
      return detector.execute(snapshot);
    }));
    const completedMs = this.#now?.() ?? requestedMs;
    const completedAt = new Date(completedMs).toISOString();
    const detectorResults: DetectorResult[] = [];
    const detectorFailures: DetectorFailure[] = [];

    settled.forEach((outcome, index) => {
      const { detectorId, detector } = detectors[index];
      if (outcome.status === 'fulfilled') {
        detectorResults.push({ ...outcome.value, runId });
        if (outcome.value.status === 'ERROR') {
          detectorFailures.push({
            detectorId,
            errorCode: outcome.value.errorCode ?? 'DETECTOR_REPORTED_ERROR',
            message: outcome.value.warnings[0] ?? 'Detector reported an error.',
          });
        }
        return;
      }

      const message = errorMessage(outcome.reason);
      const errorCode = detector ? 'DETECTOR_EXECUTION_FAILED' : 'DETECTOR_NOT_REGISTERED';
      detectorFailures.push({ detectorId, errorCode, message });
      detectorResults.push({
        detectorId,
        detectorVersion: detector?.version ?? 'unknown',
        runId,
        instrument: snapshot.instrument,
        timeframe: snapshot.timeframe,
        observedAt: completedAt,
        dataAsOf: snapshot.dataAsOf,
        status: 'ERROR',
        confidence: null,
        payload: null,
        evidence: [],
        freshness: snapshot.freshness,
        warnings: [message],
        errorCode,
      });
    });

    const failedCount = detectorResults.filter((result) => result.status === 'ERROR').length;
    return {
      runId,
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedMs - startedMs),
      detectorResults,
      detectorFailures,
      successfulCount: detectorResults.length - failedCount,
      failedCount,
    };
  }
}
