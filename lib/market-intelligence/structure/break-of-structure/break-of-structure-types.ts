import type { Iso8601String, JsonObject, NormalizedCandle } from '../../contracts.ts';
import type { ConfirmedSwing } from '../../detectors/confirmed-swing/confirmed-swing-types.ts';
import type { StructureBias, StructureSnapshot, SwingStructureLabel } from '../structure-types.ts';

export type BreakOfStructureDirection = 'BULLISH' | 'BEARISH';
export type SwingEligibilityPolicy = 'LATEST_CONFIRMED' | 'LATEST_ACCEPTED_STRUCTURE' | 'ALL_UNBROKEN_ACCEPTED';
export type DirectionalBiasRequirement = 'NONE' | 'CONTINUATION_ONLY';
export type DuplicateBreakPolicy = 'EMIT_ONCE_PER_SWING' | 'ALLOW_REBREAK_AFTER_CLOSE_BACK_INSIDE';
export type GapBreakPolicy = 'ALLOW' | 'REJECT';
export type ContinuationContext = 'CONTINUATION' | 'COUNTER_STRUCTURE' | 'UNDEFINED';

export type BreakOfStructureConfig = JsonObject & {
  closeToleranceAbsolute: number;
  closeToleranceRelative: number;
  swingEligibility: SwingEligibilityPolicy;
  requireDirectionalBias: DirectionalBiasRequirement;
  sourceSwingLabels: {
    bullish: SwingStructureLabel[];
    bearish: SwingStructureLabel[];
  };
  duplicateBreakPolicy: DuplicateBreakPolicy;
  gapBreakPolicy: GapBreakPolicy;
};

export type BreakOfStructureEvent = JsonObject & {
  id: string;
  version: string;
  direction: BreakOfStructureDirection;
  sourceSwingId: string;
  sourceSwingDirection: 'HIGH' | 'LOW';
  sourceSwingLabel: SwingStructureLabel;
  sourceSwingPrice: number;
  sourcePivotAt: Iso8601String;
  sourceConfirmedAt: Iso8601String;
  breakoutCandleIndex: number;
  breakoutOpenedAt: Iso8601String;
  detectedAt: Iso8601String;
  breakoutOpen: number;
  breakoutHigh: number;
  breakoutLow: number;
  breakoutClose: number;
  breakDistance: number;
  breakDistanceRelative: number;
  priorStructureBias: StructureBias;
  continuationContext: ContinuationContext;
  gapBreak: boolean;
  accepted: boolean;
  rejectionReason: string | null;
  sourceSnapshotId: string;
  evidence: string[];
  fingerprint: string;
};

export type BreakOfStructureDetectionInput = Readonly<{
  candles: readonly NormalizedCandle[];
  confirmedSwings: readonly ConfirmedSwing[];
  structureSnapshots: readonly StructureSnapshot[];
  config?: Partial<BreakOfStructureConfig>;
}>;

export type BreakOfStructureDetectionResult = JsonObject & {
  detectorVersion: string;
  events: BreakOfStructureEvent[];
  rejectedCandidates: BreakOfStructureEvent[];
  warnings: string[];
  configuration: BreakOfStructureConfig;
};

export type IncrementalBreakOfStructureDetector = Readonly<{
  pushConfirmedSwing(swing: ConfirmedSwing): void;
  pushStructureSnapshot(snapshot: StructureSnapshot): void;
  pushCandle(candle: NormalizedCandle): readonly BreakOfStructureEvent[];
  getNewEvents(): readonly BreakOfStructureEvent[];
  getAllEvents(): readonly BreakOfStructureEvent[];
  getRejectedCandidates(): readonly BreakOfStructureEvent[];
  getWarnings(): readonly string[];
  getResult(): BreakOfStructureDetectionResult;
  reset(): void;
}>;
