import type { Iso8601String, JsonObject, NormalizedCandle } from '../../contracts.ts';
import type { ConfirmedSwing } from '../../detectors/confirmed-swing/confirmed-swing-types.ts';
import type { BreakOfStructureEvent } from '../break-of-structure/break-of-structure-types.ts';
import type { StructureBias, StructureSnapshot, SwingStructureLabel } from '../structure-types.ts';

export type StructureTransitionClassification = 'CONTINUATION_BREAK' | 'MARKET_STRUCTURE_SHIFT' | 'CHOCH' | 'UNCLASSIFIED';
export type MarketStructureTerminologyMode = 'MSS_ONLY' | 'CHOCH_FIRST_THEN_MSS';
export type ProtectedSwingPolicy = 'LATEST_OPPOSING_STRUCTURAL_SWING' | 'LAST_HL_FOR_BULLISH_LAST_LH_FOR_BEARISH';
export type ShiftDuplicatePolicy = 'ONE_SHIFT_PER_PRIOR_BIAS_REGIME' | 'ALLOW_MULTIPLE';
export type TransitionResetPolicy = 'AFTER_OPPOSITE_BIAS_CONFIRMED' | 'AFTER_NEW_DIRECTIONAL_STRUCTURE';

export type MarketStructureShiftConfig = JsonObject & {
  terminologyMode: MarketStructureTerminologyMode;
  requireEstablishedBias: boolean;
  minimumPriorDirectionalSnapshots: number;
  requireBreakOfProtectedSwing: boolean;
  protectedSwingPolicy: ProtectedSwingPolicy;
  requireDisplacement: boolean;
  minimumBreakDistanceAbsolute: number;
  minimumBreakDistanceRelative: number;
  minimumBreakDistanceAtrMultiple: number;
  atrPeriod: number;
  duplicatePolicy: ShiftDuplicatePolicy;
  transitionResetPolicy: TransitionResetPolicy;
};

export type MarketStructureShiftEvent = JsonObject & {
  id: string;
  version: string;
  classification: StructureTransitionClassification;
  direction: 'BULLISH' | 'BEARISH';
  sourceBosEventId: string;
  sourceSwingId: string;
  priorStructureSnapshotId: string | null;
  priorBias: StructureBias;
  protectedSwingId: string | null;
  protectedSwingPrice: number | null;
  protectedSwingLabel: SwingStructureLabel | null;
  detectedAt: Iso8601String;
  breakDistance: number;
  breakDistanceRelative: number;
  breakDistanceAtrMultiple: number | null;
  priorDirectionalSnapshotCount: number;
  transitionRegimeId: string | null;
  accepted: boolean;
  rejectionReason: string | null;
  evidence: string[];
  fingerprint: string;
};

export type MarketStructureShiftInput = Readonly<{
  bosEvents: readonly BreakOfStructureEvent[];
  structureSnapshots: readonly StructureSnapshot[];
  confirmedSwings: readonly ConfirmedSwing[];
  candles?: readonly NormalizedCandle[];
  config?: Partial<MarketStructureShiftConfig>;
}>;

export type MarketStructureShiftResult = JsonObject & {
  classifierVersion: string;
  events: MarketStructureShiftEvent[];
  rejectedCandidates: MarketStructureShiftEvent[];
  warnings: string[];
  configuration: MarketStructureShiftConfig;
};

export type IncrementalMarketStructureShiftClassifier = Readonly<{
  pushConfirmedSwing(swing: ConfirmedSwing): void;
  pushStructureSnapshot(snapshot: StructureSnapshot): void;
  pushBosEvent(event: BreakOfStructureEvent): readonly MarketStructureShiftEvent[];
  pushCandle(candle: NormalizedCandle): void;
  getNewEvents(): readonly MarketStructureShiftEvent[];
  getAllEvents(): readonly MarketStructureShiftEvent[];
  getRejectedCandidates(): readonly MarketStructureShiftEvent[];
  getWarnings(): readonly string[];
  getResult(): MarketStructureShiftResult;
  reset(): void;
}>;
