import type { RuleEvaluationStatus } from '../strategy-composition/composition-types.ts';
import type { MissingEvidenceBehavior } from '../strategy-definitions/strategy-definition-types.ts';

export type ConfidenceStatus = 'CALCULATED' | 'PARTIAL' | 'UNAVAILABLE' | 'ERROR';
export type ConfidenceEngineConfig = { engineVersion: string; decimalDisplayPrecision?: number; errorTreatment: 'PARTIAL' | 'ERROR' };

export type ConfidenceContribution = {
  ruleId: string;
  ruleVersion: string;
  ruleName: string;
  requirement: 'REQUIRED' | 'OPTIONAL';
  evaluationStatus: RuleEvaluationStatus;
  matched: boolean;
  configuredWeight: number;
  eligibleWeight: number;
  earnedWeight: number;
  missingEvidenceBehavior: MissingEvidenceBehavior;
  timeframeRole: string | null;
  concreteTimeframe: string | null;
  evidenceNodeIds: string[];
  explanation: string;
  warnings: string[];
};

/** @deprecated Use ConfidenceContribution. */
export type RuleConfidenceContribution = ConfidenceContribution;

export type ConfidenceSummary = {
  totalRules: number;
  matchedRules: number;
  failedRules: number;
  unavailableRules: number;
  errorRules: number;
  confidenceDisplay: string | null;
  configuredCoverageDisplay: string | null;
  meaning: 'EVIDENCE_MATCH_RATIO_NOT_PROBABILITY';
};

export type ConfidenceAssessment = {
  assessmentId: string;
  version: '1.0.0';
  engineVersion: string;
  strategyId: string;
  strategyVersion: string;
  compiledStrategyId: string;
  strategyContextId: string;
  evidenceGraphId: string;
  sourceMarketContextId: string;
  generatedAt: string;
  status: ConfidenceStatus;
  confidenceRatio: number | null;
  confidencePercent: number | null;
  configuredCoverageRatio: number | null;
  configuredCoveragePercent: number | null;
  rawEarnedWeight: number;
  eligibleWeight: number;
  configuredWeight: number;
  contributions: ConfidenceContribution[];
  failedRequiredRuleIds: string[];
  failedOptionalRuleIds: string[];
  unavailableRequiredRuleIds: string[];
  unavailableOptionalRuleIds: string[];
  errorRuleIds: string[];
  warnings: string[];
  summary: ConfidenceSummary;
};

export type ConfidenceValidationIssue = { code: string; path: string; message: string };
export type ConfidenceValidationResult = { valid: boolean; issues: ConfidenceValidationIssue[] };
