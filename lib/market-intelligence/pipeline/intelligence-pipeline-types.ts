import type { ConfidenceAssessment } from '../confidence/confidence-types.ts';
import type { DecisionAssessment, DecisionPolicy } from '../decision/decision-types.ts';
import type { DirectionAssessment, DirectionPolicy } from '../direction/direction-types.ts';
import type { EvidenceGraph } from '../evidence-graph/evidence-graph-types.ts';
import type { MarketContext, MarketDataSnapshot } from '../contracts.ts';
import type { MarketDataRequest } from '../providers/market-data-provider.ts';
import type { ReadinessAssessment, ReadinessPolicy } from '../readiness/readiness-types.ts';
import type { StrategyContext } from '../strategy-composition/composition-types.ts';
import type { CompiledStrategyDefinition } from '../strategy-definitions/strategy-definition-types.ts';

export type IntelligencePipelineStage = 'MARKET_DATA' | 'DETECTORS' | 'MARKET_CONTEXT' | 'STRATEGY_COMPOSITION' | 'EVIDENCE_GRAPH' | 'CONFIDENCE' | 'READINESS' | 'DECISION' | 'DIRECTION';
export type IntelligencePipelineStatus = 'COMPLETED' | 'PARTIAL' | 'BLOCKED' | 'UNAVAILABLE' | 'ERROR';
export type IntelligencePipelineError = { stage: IntelligencePipelineStage; code: string; message: string; recoverable: boolean };
export type IntelligencePipelineStageResult = { stage: IntelligencePipelineStage; status: IntelligencePipelineStatus; startedFromRequestedAt: string; sourceInputIds: string[]; outputId: string | null; warnings: string[]; errors: IntelligencePipelineError[]; durationMs: null };
export type IntelligencePipelineInput = { marketDataRequest: MarketDataRequest; providerId: string; detectorIds: readonly string[]; assetClass: string; compiledStrategy: CompiledStrategyDefinition };
export type IntelligencePipelineConfig = { readinessPolicy: ReadinessPolicy; decisionPolicy: DecisionPolicy; directionPolicy: DirectionPolicy };
export type IntelligencePipelineSummary = { completedStages: number; partialStages: number; blockedStages: number; unavailableStages: number; errorStages: number; detectorCount: number; matchedRules: number; failedRules: number; meaning: 'INFORMATIONAL_DECISION_SUPPORT_NOT_TRADE_EXECUTION' };
export type IntelligencePipelineResult = {
  pipelineResultId: string; version: '1.0.0'; requestedAt: string; symbol: string; assetClass: string; strategyId: string; strategyVersion: string; compiledStrategyId: string; configurationFingerprint: string; status: IntelligencePipelineStatus; stages: IntelligencePipelineStageResult[];
  marketDataSnapshot: MarketDataSnapshot | null; marketContext: MarketContext | null; strategyContext: StrategyContext | null; evidenceGraph: EvidenceGraph | null; confidenceAssessment: ConfidenceAssessment | null; readinessAssessment: ReadinessAssessment | null; decisionAssessment: DecisionAssessment | null; directionAssessment: DirectionAssessment | null;
  warnings: string[]; errors: IntelligencePipelineError[]; summary: IntelligencePipelineSummary;
};
