import type { Iso8601String, JsonObject, NormalizedCandle } from '../../contracts.ts';
import type { ConfirmedSwing } from '../../detectors/confirmed-swing/confirmed-swing-types.ts';
import type { StructuralLiquiditySweepEvent } from '../structural-sweep/structural-liquidity-sweep-types.ts';
import type { BreakOfStructureEvent } from '../../structure/break-of-structure/break-of-structure-types.ts';
import type { StructureSnapshot, SwingStructureLabel } from '../../structure/structure-types.ts';

export type LiquidityTargetType = 'STRUCTURAL_HIGH' | 'STRUCTURAL_LOW' | 'EQUAL_HIGHS' | 'EQUAL_LOWS';
export type LiquidityTargetSide = 'BUY_SIDE' | 'SELL_SIDE';
export type LiquidityTargetStatus = 'AVAILABLE' | 'TESTED' | 'SWEPT' | 'BROKEN' | 'INVALIDATED' | 'EXPIRED';
export type LiquidityTargetLifecycleEventType = 'CREATED' | 'MEMBER_ADDED' | 'TESTED' | 'SWEPT' | 'BROKEN' | 'INVALIDATED' | 'EXPIRED';

export type StructuralLiquidityTargetConfig = JsonObject & {
  sourceEligibility: 'ALL_ACCEPTED_STRUCTURE' | 'LATEST_PER_DIRECTION' | 'UNBROKEN_ACCEPTED_ONLY';
  allowedHighLabels: SwingStructureLabel[];
  allowedLowLabels: SwingStructureLabel[];
  equalityToleranceAbsolute: number;
  equalityToleranceRelative: number;
  equalLevelMinimumMembers: number;
  touchToleranceAbsolute: number;
  touchToleranceRelative: number;
  clusterPolicy: 'KEEP_INDIVIDUAL_AND_CLUSTER' | 'CLUSTER_ONLY' | 'INDIVIDUAL_ONLY';
  bosConsumptionPolicy: 'MARK_BROKEN' | 'MARK_INVALIDATED';
  sweepConsumptionPolicy: 'MARK_SWEPT' | 'KEEP_AVAILABLE_AFTER_SWEEP';
  structuralReplacementPolicy: 'KEEP_ALL_HISTORY' | 'INVALIDATE_SUPERSEDED_LATEST';
  expirationPolicy: 'NEVER' | 'AFTER_N_CANDLES' | 'AFTER_N_MILLISECONDS';
  expirationCandles: number;
  expirationMilliseconds: number;
  proximityRankingMode: 'ABSOLUTE_DISTANCE' | 'RELATIVE_DISTANCE' | 'ATR_NORMALIZED_DISTANCE';
  atrPeriod: number;
};

export type StructuralLiquidityTarget = JsonObject & {
  id: string; version: string; side: LiquidityTargetSide; targetType: LiquidityTargetType; status: LiquidityTargetStatus;
  price: number; lowerBoundary: number; upperBoundary: number;
  sourceSwingIds: string[]; sourceSwingLabels: SwingStructureLabel[]; sourceSnapshotIds: string[];
  memberCount: number; earliestPivotAt: Iso8601String; latestPivotAt: Iso8601String; confirmedAt: Iso8601String; detectedAt: Iso8601String;
  firstTestedAt: Iso8601String | null; sweptAt: Iso8601String | null; brokenAt: Iso8601String | null; invalidatedAt: Iso8601String | null; expiredAt: Iso8601String | null;
  consumingSweepEventIds: string[]; consumingBosEventIds: string[]; evidence: string[]; lifecycleEventIds: string[]; fingerprint: string;
};

export type LiquidityTargetLifecycleEvent = JsonObject & {
  id: string; version: string; targetId: string; eventType: LiquidityTargetLifecycleEventType; detectedAt: Iso8601String;
  triggeringCandleId: string | null; triggeringCandleIndex: number | null; sourceBosEventId: string | null; sourceSweepEventId: string | null;
  priorStatus: LiquidityTargetStatus | null; newStatus: LiquidityTargetStatus; evidence: string[]; fingerprint: string;
};

export type LiquidityTargetCandidate = JsonObject & { id: string; sourceSwingId: string; rejectionReason: string; fingerprint: string };

export type RankedLiquidityTarget = JsonObject & {
  rank: number; targetId: string; side: LiquidityTargetSide; targetType: LiquidityTargetType; status: LiquidityTargetStatus;
  price: number; absoluteDistance: number; relativeDistance: number; atrNormalizedDistance: number | null;
  memberCount: number; detectedAt: Iso8601String; confirmationAgeMs: number; sourceLabels: SwingStructureLabel[];
};

export type RankLiquidityTargetsInput = Readonly<{
  targets: readonly StructuralLiquidityTarget[]; referencePrice: number; referenceTimestamp: Iso8601String; side?: LiquidityTargetSide;
  mode?: StructuralLiquidityTargetConfig['proximityRankingMode']; atrValue?: number;
}>;

export type StructuralLiquidityTargetInput = Readonly<{
  candles: readonly NormalizedCandle[]; confirmedSwings: readonly ConfirmedSwing[]; structureSnapshots: readonly StructureSnapshot[];
  bosEvents?: readonly BreakOfStructureEvent[]; sweepEvents?: readonly StructuralLiquiditySweepEvent[]; config?: Partial<StructuralLiquidityTargetConfig>;
}>;

export type StructuralLiquidityTargetResult = JsonObject & {
  detectorVersion: string; targets: StructuralLiquidityTarget[]; lifecycleEvents: LiquidityTargetLifecycleEvent[];
  rejectedCandidates: LiquidityTargetCandidate[]; warnings: string[]; configuration: StructuralLiquidityTargetConfig;
};

export type IncrementalStructuralLiquidityTargetDetector = Readonly<{
  pushConfirmedSwing(swing: ConfirmedSwing): void; pushStructureSnapshot(snapshot: StructureSnapshot): void;
  pushBosEvent(event: BreakOfStructureEvent): void; pushSweepEvent(event: StructuralLiquiditySweepEvent): void;
  pushCandle(candle: NormalizedCandle): readonly StructuralLiquidityTarget[];
  getNewTargets(): readonly StructuralLiquidityTarget[]; getNewLifecycleEvents(): readonly LiquidityTargetLifecycleEvent[];
  getAllTargets(): readonly StructuralLiquidityTarget[]; getAvailableTargets(): readonly StructuralLiquidityTarget[]; getTerminalTargets(): readonly StructuralLiquidityTarget[];
  getRejectedCandidates(): readonly LiquidityTargetCandidate[]; getWarnings(): readonly string[];
  rankAvailableTargets(input: Omit<RankLiquidityTargetsInput, 'targets'>): readonly RankedLiquidityTarget[];
  getResult(): StructuralLiquidityTargetResult; reset(): void;
}>;
