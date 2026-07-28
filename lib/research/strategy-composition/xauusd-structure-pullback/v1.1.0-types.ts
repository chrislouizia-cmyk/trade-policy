import type { DisplacementObservation, Iso8601String, JsonObject, NormalizedCandle } from '../../../market-intelligence/contracts.ts';
import type { FairValueGap } from '../../../market-intelligence/imbalance/fair-value-gap/fair-value-gap-lifecycle-types.ts';
import type { StructuralLiquidityTarget } from '../../../market-intelligence/liquidity/targets/structural-liquidity-target-types.ts';
import type { StructuralLiquiditySweepEvent } from '../../../market-intelligence/liquidity/structural-sweep/structural-liquidity-sweep-types.ts';
import type { StructuralStopCandidate } from '../../../market-intelligence/risk/structural-stop-candidates/structural-stop-candidate-types.ts';
import type { MarketStructureShiftEvent } from '../../../market-intelligence/structure/market-structure-shift/market-structure-shift-types.ts';
import type { StructureSnapshot } from '../../../market-intelligence/structure/structure-types.ts';
import type { StrategyConditionEvaluation, StrategySetupStatus } from './composition-types.ts';

export type StructureConsumptionRecord = JsonObject & {
  id: string;
  version: '1.0.0';
  structureIdentity: string;
  transitionEventId: string;
  consumedAt: Iso8601String;
  entryCandleOpenedAt: Iso8601String;
};

export type ExecutableStrategySetupV110 = JsonObject & {
  id: string;
  version: '1.1.0';
  strategyId: 'xauusd-structure-pullback';
  strategyVersion: '1.1.0';
  strategyDnaHash: string;
  direction: 'LONG' | 'SHORT';
  status: StrategySetupStatus;
  structureIdentity: string | null;
  transitionEventId: string | null;
  sweepEventId: string | null;
  fvgId: string | null;
  triggerCandleOpenedAt: Iso8601String | null;
  entryCandleOpenedAt: Iso8601String | null;
  entryPrice: number | null;
  stopCandidateId: string | null;
  stopPrice: number | null;
  targetId: string | null;
  targetPrice: number | null;
  rewardToRisk: number | null;
  conditionEvaluations: StrategyConditionEvaluation[];
  blockingReasons: string[];
  invalidationReasons: string[];
  fingerprint: string;
};

export type StrategyCompositionInputV110 = Readonly<{
  strategyDna: string;
  referenceTimestamp: Iso8601String;
  direction: 'LONG' | 'SHORT';
  symbol: string;
  timeframe: string;
  candles: readonly NormalizedCandle[];
  structureSnapshots: readonly StructureSnapshot[];
  transitionEvents: readonly MarketStructureShiftEvent[];
  sweepEvents: readonly StructuralLiquiditySweepEvent[];
  displacementObservations: readonly DisplacementObservation[];
  fairValueGaps: readonly FairValueGap[];
  stopCandidates: readonly StructuralStopCandidate[];
  liquidityTargets: readonly StructuralLiquidityTarget[];
  consumptionRecords?: readonly StructureConsumptionRecord[];
}>;

export type StrategyCompositionResultV110 = JsonObject & {
  strategyId: 'xauusd-structure-pullback';
  strategyVersion: '1.1.0';
  strategyDnaHash: string;
  setup: ExecutableStrategySetupV110;
  fingerprint: string;
};

export type DependencyAuditStatus = JsonObject & {
  dependency: string;
  status: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED';
  implementation: string | null;
};

export type StrategyReadinessAudit = JsonObject & {
  strategyId: string;
  strategyVersion: string;
  strategyDnaHash: string;
  mandatoryRuleCount: number;
  executableRuleCount: number;
  unsupportedRuleCount: number;
  ambiguousRuleCount: number;
  detectorDependencies: DependencyAuditStatus[];
  compositionSupported: boolean;
  executionMappingReady: boolean;
  officialBacktestAllowed: boolean;
  blockingReasons: string[];
  fingerprint: string;
};
