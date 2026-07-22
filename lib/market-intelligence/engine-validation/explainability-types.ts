import type { EvidenceGraph } from '../evidence-graph/evidence-graph-types.ts';
import type { DecisionCriterionResult } from '../decision/decision-types.ts';
import type { Interval } from './validation-types.ts';

export type PipelineStageTiming = { stage: string; durationMs: number };
export type PipelineTimingTrace = { totalDurationMs: number; stages: readonly PipelineStageTiming[]; diagnosticOnly: true };

export type DetectorOpportunityTrace = {
  detectorId: string;
  detectorVersion: string;
  status: 'DETECTED' | 'NOT_DETECTED' | 'INSUFFICIENT_DATA' | 'ERROR';
  fired: boolean;
  blocked: boolean;
  blockingRuleIds: readonly string[];
  referencedRuleIds: readonly string[];
  confidenceConfiguredWeight: number;
  confidenceEligibleWeight: number;
  confidenceEarnedWeight: number;
  readinessContributionPercent: number;
  evidenceIds: readonly string[];
};

export type OpportunityExplainabilityTrace = {
  detectorTraces: readonly DetectorOpportunityTrace[];
  firedDetectorIds: readonly string[];
  blockingDetectorIds: readonly string[];
  evidenceGraph: EvidenceGraph | null;
  decisionPath: readonly DecisionCriterionResult[];
  finalDecisionOutcome: string | null;
  finalDirection: 'BUY' | 'SELL' | null;
  directionSource: 'ENGINE' | 'DIAGNOSTIC' | 'UNAVAILABLE';
  timing: PipelineTimingTrace | null;
  regimeTags: readonly string[];
};

export type DetectorExplainabilityAggregate = {
  detectorId: string;
  evaluated: number;
  fired: number;
  fireRate: Interval;
  blockedTrades: number;
  approvedWinsWhenFired: number;
  falsePositivesWhenFired: number;
  falsePositiveRateWhenFired: Interval | null;
  rejectedWinningTradesAttributed: number;
  falseNegativesAttributed: number;
  averageConfidenceEarnedWeight: number;
  averageReadinessContributionPercent: number;
  verdictInfluenceRate: number;
  predictiveContribution: 'CONTRIBUTES' | 'REDUCES_PERFORMANCE' | 'INCONCLUSIVE';
  calibrationPriorityScore: number;
};

export type DetectorInteraction = {
  leftDetectorId: string;
  rightDetectorId: string;
  coFired: number;
  approved: number;
  wins: number;
  successRate: Interval | null;
  liftVersusEngine: number | null;
  interpretation: 'POSITIVE' | 'NEGATIVE' | 'INCONCLUSIVE';
};

export type DetectorCombination = {
  detectorIds: readonly string[];
  occurrences: number;
  approved: number;
  wins: number;
  successRate: Interval | null;
  meanDirectionalReturnBps: Interval | null;
};

export type DetectorRedundancy = {
  leftDetectorId: string;
  rightDetectorId: string;
  jaccardSimilarity: number;
  sameStateRate: number;
  interpretation: 'POTENTIALLY_REDUNDANT' | 'DISTINCT';
};

export type RegimeDetectorFailure = {
  regime: string;
  detectorId: string;
  sampleSize: number;
  failures: number;
  failureRate: Interval;
};

export type PipelineTimingAggregate = {
  measuredOpportunities: number;
  meanTotalDurationMs: number | null;
  stages: readonly { stage: string; samples: number; meanMs: number; maximumMs: number }[];
  diagnosticOnly: true;
};

export type ExplainableOpportunityRecord = {
  opportunityId: string;
  evaluatedAt: string;
  approved: boolean;
  successful: boolean | null;
  readinessPercent: number | null;
  directionalReturnBps: number | null;
  trace: OpportunityExplainabilityTrace;
};

export type EngineExplainabilitySummary = {
  opportunities: readonly ExplainableOpportunityRecord[];
  detectors: readonly DetectorExplainabilityAggregate[];
  interactionMatrix: readonly DetectorInteraction[];
  bestCombinations: readonly DetectorCombination[];
  failingCombinations: readonly DetectorCombination[];
  redundancy: readonly DetectorRedundancy[];
  regimeFailures: readonly RegimeDetectorFailure[];
  timings: PipelineTimingAggregate;
  calibrationPriority: readonly string[];
  conclusions: readonly string[];
};
