import type { IntelligencePipelineResult } from '../pipeline/intelligence-pipeline-types.ts';
import type { NormalizedCandle } from '../contracts.ts';
import type { EngineExplainabilitySummary, OpportunityExplainabilityTrace, PipelineTimingTrace } from './explainability-types.ts';
import type { ReproducibilityAssessment, ResearchArtifactProvenance } from '../../market-intelligence-lab/reproducibility/reproducibility-types.ts';
import type { LocalRegimeObservation } from './local-regime.ts';

export type ValidationDirection = 'BUY' | 'SELL';
export type Interval = { estimate: number; lower: number; upper: number; confidenceLevel: number };

export type HistoricalValidationDataset = {
  id: string;
  version: string;
  instrument: string;
  assetClass: string;
  timeframe: string;
  provider: string;
  contentHash: string;
  certificationStatus: 'CERTIFIED';
  candles: readonly NormalizedCandle[];
};

export type EngineValidationProtocol = {
  version: '1.0.0';
  horizonCandles: number;
  warmupCandles: number;
  sampleStride: number;
  minimumReturnBps: number;
  confidenceLevel: number;
  bootstrapIterations: number;
  calibrationFraction: number;
  readinessThresholds: readonly number[];
  minimumThresholdCoverage: number;
  seed: number;
};

export type PipelineReplayInput = {
  dataset: HistoricalValidationDataset;
  candles: readonly NormalizedCandle[];
  requestedAt: string;
  detectorIds: readonly string[];
};

export interface PipelineReplayPort {
  evaluate(input: PipelineReplayInput): Promise<IntelligencePipelineResult>;
}
export interface ExplainablePipelineReplayPort extends PipelineReplayPort {
  evaluateWithTrace(input: PipelineReplayInput): Promise<{ result: IntelligencePipelineResult; timing: PipelineTimingTrace; counterfactualDirection: ValidationDirection | null }>;
}

export type ValidationOpportunity = {
  id: string;
  index: number;
  evaluatedAt: string;
  entryPrice: number;
  exitPrice: number;
  forwardReturnBps: number;
  direction: ValidationDirection | null;
  directionalReturnBps: number | null;
  successful: boolean | null;
  readinessPercent: number | null;
  readinessStatus: string | null;
  approved: boolean;
  pipelineStatus: string;
  detectorStates: Record<string, 'DETECTED' | 'NOT_DETECTED' | 'INSUFFICIENT_DATA' | 'ERROR' | 'MISSING'>;
  warnings: readonly string[];
  localRegime: LocalRegimeObservation;
  explainability: OpportunityExplainabilityTrace | null;
};

export type ClassificationMetrics = {
  sampleSize: number;
  evaluableDirections: number;
  approved: number;
  rejected: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  coverage: Interval;
  successRate: Interval | null;
  falsePositiveRate: Interval | null;
  falseNegativeRate: Interval | null;
  precision: Interval | null;
  recall: Interval | null;
  balancedAccuracy: number | null;
  readinessOutcomeCorrelation: Interval | null;
  readinessAuc: Interval | null;
  meanDirectionalReturnBps: Interval | null;
};

export type ReadinessBucket = {
  minimum: number;
  maximum: number;
  sampleSize: number;
  approved: number;
  successRate: Interval | null;
  meanDirectionalReturnBps: Interval | null;
};

export type ThresholdResult = {
  threshold: number;
  metrics: ClassificationMetrics;
  objective: number | null;
};

export type BaselineResult = {
  id: 'RANDOM_SELECTION' | 'SMA_10_24';
  description: string;
  metrics: ClassificationMetrics;
  differenceInSuccessRate: Interval | null;
};

export type DetectorContribution = {
  detectorId: string;
  fullEngineSuccessRate: number | null;
  ablatedSuccessRate: number | null;
  successRateDelta: number | null;
  successRateDifference: Interval | null;
  fullEngineCoverage: number;
  ablatedCoverage: number;
  coverageDelta: number;
  interpretation: 'CONTRIBUTES' | 'REDUCES_PERFORMANCE' | 'INCONCLUSIVE';
};

export type FailureSegment = {
  key: string;
  sampleSize: number;
  failures: number;
  failureRate: Interval;
};

export type ValidationConclusion = {
  verdict: 'PREDICTIVE_VALUE_DEMONSTRATED' | 'NO_PREDICTIVE_VALUE_DEMONSTRATED' | 'INCONCLUSIVE';
  statements: readonly string[];
  limitations: readonly string[];
};

export type EngineValidationReport = {
  reportVersion: '1.0.0';
  reportId: string;
  dataset: Omit<HistoricalValidationDataset, 'candles'> & { candleCount: number; startAt: string; endAt: string };
  protocol: EngineValidationProtocol;
  detectorIds: readonly string[];
  generatedAt: string;
  calibration: { sampleSize: number; thresholdCurve: readonly ThresholdResult[]; selectedThreshold: number | null };
  holdout: { sampleSize: number; engine: ClassificationMetrics; selectedThreshold: ThresholdResult | null };
  readinessBuckets: readonly ReadinessBucket[];
  baselines: readonly BaselineResult[];
  detectorContributions: readonly DetectorContribution[];
  failureSegments: readonly FailureSegment[];
  dataQuality: { totalCandidates: number; evaluated: number; missingDirection: number; pipelineErrors: number; warnings: readonly string[] };
  conclusion: ValidationConclusion;
  explainability: EngineExplainabilitySummary;
  provenance: ResearchArtifactProvenance;
  reproducibility: ReproducibilityAssessment;
};
