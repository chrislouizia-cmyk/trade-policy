import type { JsonValue } from '../contracts.ts';

export type ReadinessStatus = 'READY' | 'WAIT' | 'BLOCKED' | 'UNAVAILABLE' | 'ERROR';
export type ReadinessSeverity = 'INFO' | 'WARNING' | 'BLOCKING';
export type ReadinessCriterionStatus = 'PASSED' | 'FAILED' | 'NOT_EVALUATED' | 'ERROR';
export type ReadinessCriterionId = 'confidence-threshold' | 'coverage-threshold' | 'required-rules' | 'required-rule-failure' | 'required-rule-unavailable' | 'rule-errors' | 'partial-confidence' | 'minimum-matched-rules' | 'maximum-optional-failures';

export type ReadinessPolicy = {
  id: string;
  version: string;
  name: string;
  description: string;
  minimumConfidencePercent: number;
  minimumCoveragePercent: number;
  requireAllRequiredRulesMatched: boolean;
  blockOnRequiredRuleFailure: boolean;
  blockOnRequiredRuleUnavailable: boolean;
  blockOnAnyRuleError: boolean;
  allowPartialConfidence: boolean;
  minimumMatchedRuleCount?: number;
  maximumFailedOptionalRules?: number;
  criteriaOrder: ReadinessCriterionId[];
  metadata: { schemaVersion: '1.0.0'; tags: string[]; owner?: string };
};

export type ReadinessCriterion = { id: ReadinessCriterionId; name: string };
export type ReadinessCriterionResult = {
  criterionId: ReadinessCriterionId;
  name: string;
  order: number;
  status: ReadinessCriterionStatus;
  severity: ReadinessSeverity;
  actualValue: JsonValue;
  expectedValue: JsonValue;
  comparisonOperator: '>=' | '<=' | 'ALL_MATCHED' | 'NONE' | 'ALLOWED';
  passed: boolean;
  explanation: string;
  relatedRuleIds: string[];
  relatedEvidenceNodeIds: string[];
  warnings: string[];
};

export type ReadinessSummary = { totalCriteria: number; passedCriteria: number; failedCriteria: number; notEvaluatedCriteria: number; errorCriteria: number; blockingFailures: number; meaning: 'SETUP_COMPLETENESS_NOT_TRADE_AUTHORIZATION' };
export type ReadinessAssessment = {
  assessmentId: string;
  version: '1.0.0';
  engineVersion: '1.0.0';
  policyId: string;
  policyVersion: string;
  strategyId: string;
  strategyVersion: string;
  compiledStrategyId: string;
  strategyContextId: string;
  evidenceGraphId: string;
  confidenceAssessmentId: string;
  sourceMarketContextId: string;
  generatedAt: string;
  status: ReadinessStatus;
  criteria: ReadinessCriterionResult[];
  failedCriterionIds: ReadinessCriterionId[];
  blockingCriterionIds: ReadinessCriterionId[];
  warningCriterionIds: ReadinessCriterionId[];
  failedRequiredRuleIds: string[];
  unavailableRequiredRuleIds: string[];
  errorRuleIds: string[];
  matchedRuleCount: number;
  failedRuleCount: number;
  confidencePercent: number | null;
  coveragePercent: number | null;
  summary: ReadinessSummary;
  warnings: string[];
};
export type ReadinessValidationIssue = { code: string; path: string; message: string };
export type ReadinessValidationResult = { valid: boolean; issues: ReadinessValidationIssue[] };
