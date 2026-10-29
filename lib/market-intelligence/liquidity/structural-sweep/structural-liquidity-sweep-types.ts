import type { Iso8601String, JsonObject, NormalizedCandle } from '../../contracts.ts';
import type { ConfirmedSwing } from '../../detectors/confirmed-swing/confirmed-swing-types.ts';
import type { BreakOfStructureEvent } from '../../structure/break-of-structure/break-of-structure-types.ts';
import type { StructureBias, StructureSnapshot, SwingStructureLabel } from '../../structure/structure-types.ts';

export type LiquiditySweepDirection = 'BUY_SIDE' | 'SELL_SIDE';
export type LiquiditySourceType = 'CONFIRMED_SWING' | 'ACCEPTED_STRUCTURE_SWING' | 'EQUAL_HIGHS_CLUSTER' | 'EQUAL_LOWS_CLUSTER';
export type LiquiditySourceEligibility = 'LATEST_CONFIRMED' | 'LATEST_ACCEPTED_STRUCTURE' | 'ALL_UNCONSUMED_ACCEPTED';

export type StructuralLiquiditySweepConfig = JsonObject & {
  sourceEligibility: LiquiditySourceEligibility;
  allowedSourceLabels: { buySide: SwingStructureLabel[]; sellSide: SwingStructureLabel[] };
  excursionToleranceAbsolute: number;
  excursionToleranceRelative: number;
  reclaimToleranceAbsolute: number;
  reclaimToleranceRelative: number;
  minimumExcursionAbsolute: number;
  minimumExcursionRelative: number;
  minimumExcursionAtrMultiple: number;
  atrPeriod: number;
  closePolicy: 'CLOSE_BACK_INSIDE' | 'CLOSE_AT_OR_INSIDE' | 'CLOSE_BEYOND_ALLOWED_IF_NO_BOS';
  bosConflictPolicy: 'BOS_WINS' | 'SWEEP_WINS' | 'REJECT_AMBIGUOUS';
  consumptionPolicy: 'CONSUME_ONCE' | 'ALLOW_REPEAT_AFTER_RESET';
  repeatResetPolicy: 'AFTER_NEW_STRUCTURAL_LEVEL' | 'AFTER_CLOSE_BACK_BEYOND_LEVEL' | 'MANUAL_ONLY';
  gapPolicy: 'ALLOW' | 'REJECT';
  sameCandleDualSweepPolicy: 'ALLOW_BOTH' | 'PROCESS_BUY_SIDE_THEN_SELL_SIDE' | 'PROCESS_SELL_SIDE_THEN_BUY_SIDE' | 'REJECT_AMBIGUOUS';
};

export type StructuralLiquiditySweepEvent = JsonObject & {
  id: string;
  version: string;
  direction: LiquiditySweepDirection;
  sourceType: LiquiditySourceType;
  sourceSwingId: string;
  sourceSwingDirection: 'HIGH' | 'LOW';
  sourceSwingLabel: SwingStructureLabel | null;
  sourcePrice: number;
  sourcePivotAt: Iso8601String;
  sourceConfirmedAt: Iso8601String;
  sourceSnapshotId: string | null;
  priorStructureBias: StructureBias;
  sweepCandleIndex: number;
  sweepOpenedAt: Iso8601String;
  detectedAt: Iso8601String;
  open: number;
  high: number;
  low: number;
  close: number;
  excursionDistance: number;
  excursionDistanceRelative: number;
  excursionAtrMultiple: number | null;
  reclaimDistance: number;
  wickLengthBeyondLevel: number;
  closePositionRelativeToSource: number;
  gapSweep: boolean;
  conflictingBosEventId: string | null;
  consumedSource: boolean;
  accepted: boolean;
  rejectionReason: string | null;
  evidence: string[];
  fingerprint: string;
};

export type StructuralLiquiditySweepInput = Readonly<{
  candles: readonly NormalizedCandle[];
  confirmedSwings: readonly ConfirmedSwing[];
  structureSnapshots: readonly StructureSnapshot[];
  bosEvents?: readonly BreakOfStructureEvent[];
  config?: Partial<StructuralLiquiditySweepConfig>;
}>;

export type StructuralLiquiditySweepResult = JsonObject & {
  detectorVersion: string;
  events: StructuralLiquiditySweepEvent[];
  rejectedCandidates: StructuralLiquiditySweepEvent[];
  warnings: string[];
  configuration: StructuralLiquiditySweepConfig;
};

export type IncrementalStructuralLiquiditySweepDetector = Readonly<{
  pushConfirmedSwing(swing: ConfirmedSwing): void;
  pushStructureSnapshot(snapshot: StructureSnapshot): void;
  pushBosEvent(event: BreakOfStructureEvent): void;
  pushCandle(candle: NormalizedCandle): readonly StructuralLiquiditySweepEvent[];
  getNewEvents(): readonly StructuralLiquiditySweepEvent[];
  getAllEvents(): readonly StructuralLiquiditySweepEvent[];
  getRejectedCandidates(): readonly StructuralLiquiditySweepEvent[];
  getWarnings(): readonly string[];
  getResult(): StructuralLiquiditySweepResult;
  reset(): void;
}>;
