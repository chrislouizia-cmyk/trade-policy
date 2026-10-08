import type { Iso8601String, JsonObject, NormalizedCandle } from '../../contracts.ts';
import type { ConfirmedSwing } from '../../detectors/confirmed-swing/confirmed-swing-types.ts';
import type { FairValueGap, FairValueGapStatus } from '../../imbalance/fair-value-gap/fair-value-gap-lifecycle-types.ts';
import type { StructuralLiquiditySweepEvent } from '../../liquidity/structural-sweep/structural-liquidity-sweep-types.ts';
import type { BreakOfStructureEvent } from '../../structure/break-of-structure/break-of-structure-types.ts';
import type { MarketStructureShiftEvent } from '../../structure/market-structure-shift/market-structure-shift-types.ts';
import type { StructureSnapshot, SwingStructureLabel } from '../../structure/structure-types.ts';

export type StopCandidateDirection = 'FOR_LONG' | 'FOR_SHORT';
export type StructuralStopCandidateType = 'PROTECTED_SWING' | 'LATEST_CONFIRMED_SWING' | 'SWEEP_EXTREME' | 'FVG_FAR_BOUNDARY' | 'STRUCTURAL_INVALIDATION_LEVEL' | 'COMBINED_STRUCTURAL_ORIGIN_FVG';
export type StopCandidateRejectionReason = 'STOP_NOT_BELOW_REFERENCE_FOR_LONG' | 'STOP_NOT_ABOVE_REFERENCE_FOR_SHORT' | 'SOURCE_NOT_AVAILABLE_AT_REFERENCE_TIME' | 'ATR_UNAVAILABLE' | 'SOURCE_TERMINAL_OR_INELIGIBLE' | 'EXPLICIT_SOURCE_NOT_FOUND' | 'STRUCTURAL_CONTEXT_UNAVAILABLE';

export type StructuralStopCandidateConfig = JsonObject & {
  enabledCandidateTypes: StructuralStopCandidateType[];
  protectedSwingPolicy: 'ACTIVE_PROTECTED_SWING' | 'LATEST_ACCEPTED_OPPOSING_SWING';
  latestSwingPolicy: 'LATEST_CONFIRMED' | 'LATEST_ACCEPTED_STRUCTURE';
  eligibleFvgStatuses: FairValueGapStatus[];
  fvgSelectionPolicy: 'EXPLICIT_SOURCE_ONLY' | 'NEAREST_ELIGIBLE' | 'ALL_ELIGIBLE';
  sweepSelectionPolicy: 'EXPLICIT_SOURCE_ONLY' | 'LATEST_RELEVANT' | 'ALL_RELEVANT';
  bufferPolicy: 'NONE' | 'ABSOLUTE' | 'RELATIVE' | 'ATR' | 'MAX_OF_CONFIGURED';
  absoluteBuffer: number; relativeBuffer: number; atrBufferMultiple: number; atrPeriod: number;
  candidateValidityPolicy: 'MUST_BE_BEYOND_REFERENCE_PRICE' | 'ALLOW_ANY_STRUCTURAL_LEVEL';
  deduplicationPolicy: 'KEEP_ALL' | 'MERGE_SAME_EFFECTIVE_PRICE';
  deduplicationTolerance: number;
  rankingMode: 'DISTANCE' | 'STRUCTURAL_PRIORITY' | 'HYBRID';
  maximumCandidateCount: number | null;
};

export type StructuralStopCandidateRequest = JsonObject & {
  direction: StopCandidateDirection; referencePrice: number; referenceTimestamp: Iso8601String; referenceCandleIndex?: number;
  sourceBosEventId?: string; sourceTransitionEventId?: string; sourceSweepEventId?: string; sourceFvgId?: string; sourceStructureSnapshotId?: string;
};

export type StructuralStopCandidate = JsonObject & {
  id: string; version: string; direction: StopCandidateDirection; candidateType: StructuralStopCandidateType;
  sourceCandidateTypes: StructuralStopCandidateType[]; rawInvalidationPrice: number; effectiveStopPrice: number; appliedBuffer: number;
  referencePrice: number; referenceTimestamp: Iso8601String; absoluteDistance: number; relativeDistance: number; atrNormalizedDistance: number | null;
  sourceSwingIds: string[]; sourceSwingLabels: SwingStructureLabel[]; sourceSnapshotIds: string[]; sourceSweepEventIds: string[]; sourceFvgIds: string[];
  sourceBosEventIds: string[]; sourceTransitionEventIds: string[]; sourceDetectedAt: Iso8601String; sourceDescription: string;
  structuralPriority: number; rank: number | null; valid: boolean; rejectionReason: StopCandidateRejectionReason | null; evidence: string[]; fingerprint: string;
};

export type StructuralStopCandidateInput = Readonly<{
  request: StructuralStopCandidateRequest; candles?: readonly NormalizedCandle[]; confirmedSwings: readonly ConfirmedSwing[];
  structureSnapshots: readonly StructureSnapshot[]; bosEvents?: readonly BreakOfStructureEvent[]; transitionEvents?: readonly MarketStructureShiftEvent[];
  sweepEvents?: readonly StructuralLiquiditySweepEvent[]; fairValueGaps?: readonly FairValueGap[]; config?: Partial<StructuralStopCandidateConfig>;
}>;
export type StructuralStopCandidateResult = JsonObject & { generatorVersion: string; candidates: StructuralStopCandidate[]; rejectedCandidates: StructuralStopCandidate[]; warnings: string[]; request: StructuralStopCandidateRequest; configuration: StructuralStopCandidateConfig };
export type StructuralStopCandidateGenerator = Readonly<{
  pushCandle(value: NormalizedCandle): void; pushConfirmedSwing(value: ConfirmedSwing): void; pushStructureSnapshot(value: StructureSnapshot): void;
  pushBosEvent(value: BreakOfStructureEvent): void; pushTransitionEvent(value: MarketStructureShiftEvent): void; pushSweepEvent(value: StructuralLiquiditySweepEvent): void; pushFairValueGapSnapshot(value: FairValueGap): void;
  generateCandidates(request: StructuralStopCandidateRequest): StructuralStopCandidateResult; getWarnings(): readonly string[]; reset(): void;
}>;
