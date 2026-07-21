import type { JsonObject, MarketContext } from '../contracts.ts';

export type StrategyDefinition = {
  id: string;
  version: string;
  requiredTrend?: 'BULLISH' | 'BEARISH' | 'RANGE';
  ruleConfiguration?: Record<string, JsonObject>;
  ruleExecutionOrder?: string[];
  ruleRequirements?: Record<string, 'REQUIRED' | 'OPTIONAL'>;
  ruleMissingEvidenceBehaviors?: Record<string, 'NOT_EVALUATED' | 'FAIL' | 'IGNORE'>;
};

export type RuleEvaluationStatus = 'MATCHED' | 'FAILED' | 'NOT_EVALUATED' | 'ERROR';

export type EvidenceReference = {
  detectorId: string;
  timeframe: string;
  resultIndex: number;
  evidenceIds: string[];
};

export type RuleEvaluationResult = {
  ruleId: string;
  ruleVersion: string;
  status: RuleEvaluationStatus;
  matched: boolean;
  confidenceContribution: number;
  evidenceReferences: EvidenceReference[];
  explanation: string;
  warnings: string[];
  requirement?: 'REQUIRED' | 'OPTIONAL';
};

export type CompositionRuleMetadata = {
  id: string;
  name: string;
  version: string;
  deterministic: true;
  supportedStrategies: string[];
  description: string;
};

export interface CompositionRule {
  readonly metadata: CompositionRuleMetadata;
  evaluate(strategy: StrategyDefinition, context: MarketContext): RuleEvaluationResult;
}

export type StrategyEvidenceMap = Record<string, EvidenceReference[]>;

export type StrategyExecutionSummary = {
  totalRules: number;
  totalMatched: number;
  totalFailed: number;
  totalNotEvaluated: number;
  totalErrors: number;
};

export type StrategyContext = {
  contextId: string;
  contextVersion: '1.0.0';
  strategyId: string;
  strategyVersion: string;
  marketContextId: string;
  executionTimestamp: string;
  ruleResults: RuleEvaluationResult[];
  evidenceMap: StrategyEvidenceMap;
  matchedRuleIds: string[];
  failedRuleIds: string[];
  warnings: string[];
  confidenceContributions: Record<string, number>;
  totalMatched: number;
  totalFailed: number;
  executionSummary: StrategyExecutionSummary;
};
