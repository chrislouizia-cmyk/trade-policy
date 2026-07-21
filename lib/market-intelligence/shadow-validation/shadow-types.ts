import type { AtrObservation, BreakOfStructureObservation, DisplacementObservation, FairValueGapObservation, LiquiditySweepObservation, RangeLevelsObservation, RejectionCandleObservation, RetestObservation, TrendObservation, VolatilityRequirementObservation, VolumeExpansionObservation } from '../contracts.ts';

export type ShadowComparisonStatus = 'MATCH' | 'MISMATCH' | 'NOT_COMPARABLE' | 'LEGACY_UNAVAILABLE' | 'NEW_UNAVAILABLE' | 'BOTH_UNAVAILABLE' | 'ERROR';
export type NumericFieldComparison = { field: string; legacyValue: number | null; newValue: number | null; exactMatch: boolean | null; absoluteDelta: number | null; relativeDeltaPercent: number | null; withinTolerance: boolean | null };
export type ScalarFieldComparison = { field: string; legacyValue: string | boolean | number | null; newValue: string | boolean | number | null; match: boolean };
export type DetectorShadowComparison = { detectorId: string; timeframe: string; status: ShadowComparisonStatus; exactMatch: boolean; numericComparisons: NumericFieldComparison[]; scalarComparisons: ScalarFieldComparison[]; legacyStatus: string; newStatus: string; mismatchReasons: string[]; warnings: string[] };
export type ShadowValidationSummary = { totalComparisons: number; matches: number; mismatches: number; notComparable: number; unavailable: number; errors: number; matchRate: number | null };
export type ShadowValidationReport = { version: '1.0.0'; symbol: string; requestedAt: string; generatedFromSnapshotId?: string; comparisons: DetectorShadowComparison[]; summary: ShadowValidationSummary };

export type LegacyComparablePayloads = {
  atr: AtrObservation;
  trend: TrendObservation;
  'range-levels': RangeLevelsObservation;
  'break-of-structure': BreakOfStructureObservation;
  'liquidity-sweep': LiquiditySweepObservation;
  'fair-value-gap': FairValueGapObservation;
  'rejection-candle': RejectionCandleObservation;
  'volume-expansion': VolumeExpansionObservation;
  displacement: DisplacementObservation;
  'volatility-requirement': VolatilityRequirementObservation;
  retest: RetestObservation;
};
export type LegacyComparableDetectorId = keyof LegacyComparablePayloads;
export type LegacyComparableObservation<K extends LegacyComparableDetectorId = LegacyComparableDetectorId> = { detectorId: K; timeframe: string; status: 'AVAILABLE' | 'UNAVAILABLE' | 'ERROR'; payload: LegacyComparablePayloads[K] | null; warnings: string[] };
export type LegacyComparableObservations = { snapshotId: string; observations: LegacyComparableObservation[] };
