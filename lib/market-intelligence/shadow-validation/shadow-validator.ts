import type { MarketContext, MarketDataSnapshot } from '../contracts.ts';
import { compareDetector } from './detector-comparators.ts';
import { createLegacyComparableObservations } from './legacy-shadow-adapter.ts';
import { DEFAULT_SHADOW_EPSILON } from './numeric-comparison.ts';
import { summarizeShadowComparisons } from './shadow-summary.ts';
import type { LegacyComparableObservations, ShadowValidationReport } from './shadow-types.ts';

type ShadowValidatorOptions = { epsilon?: number; legacyAdapter?: (snapshot: MarketDataSnapshot) => LegacyComparableObservations };

export class ShadowValidator {
  readonly #epsilon: number;
  readonly #legacyAdapter: (snapshot: MarketDataSnapshot) => LegacyComparableObservations;
  constructor(options: ShadowValidatorOptions = {}) { this.#epsilon = options.epsilon ?? DEFAULT_SHADOW_EPSILON; this.#legacyAdapter = options.legacyAdapter ?? createLegacyComparableObservations; }

  validate(snapshot: MarketDataSnapshot, context: MarketContext): ShadowValidationReport {
    const legacy = this.#legacyAdapter(snapshot);
    const comparisons = legacy.observations.map((observation) => {
      if (context.snapshotId !== snapshot.id || legacy.snapshotId !== snapshot.id) return { detectorId: observation.detectorId, timeframe: observation.timeframe, status: 'ERROR' as const, exactMatch: false, numericComparisons: [], scalarComparisons: [], legacyStatus: observation.status, newStatus: 'INVALID_SNAPSHOT', mismatchReasons: ['Both comparison sides must originate from the same snapshot ID.'], warnings: [] };
      const result = context.detectorResults.find((item) => item.detectorId === observation.detectorId && item.timeframe === observation.timeframe);
      return compareDetector(observation, result, this.#epsilon);
    });
    return Object.freeze({ version: '1.0.0', symbol: snapshot.instrument, requestedAt: snapshot.requestedAt, generatedFromSnapshotId: snapshot.id, comparisons, summary: summarizeShadowComparisons(comparisons) });
  }
}
