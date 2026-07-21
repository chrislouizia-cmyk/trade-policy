import type { JsonObject } from '../contracts.ts';
import type { StrategyDefinition } from '../strategy-composition/composition-types.ts';

export type StrategyTradingStyle = 'SCALPING' | 'INTRADAY' | 'SWING' | 'POSITION' | 'CUSTOM';
export type StrategyRuleRequirement = 'REQUIRED' | 'OPTIONAL';
export type MissingEvidenceBehavior = 'NOT_EVALUATED' | 'FAIL' | 'IGNORE';
export type DirectionalRuleCondition = { type: 'RULE_STATUS'; status: 'MATCHED' | 'FAILED' | 'NOT_EVALUATED' | 'ERROR' } | { type: 'RULE_MATCH'; matched: boolean };
export type DirectionalRuleDefinition = { ruleId: string; buyWhen: DirectionalRuleCondition; sellWhen: DirectionalRuleCondition; priority: number; required: boolean };
export type DirectionConfiguration = { mode: 'FIXED' | 'RULE_DERIVED' | 'DUAL_SCENARIO'; fixedDirection?: 'BUY' | 'SELL'; directionalRules?: DirectionalRuleDefinition[]; conflictBehavior: 'CONFLICTED' | 'NO_DIRECTION' | 'ERROR' };

export type DeclarativeStrategyRule = {
  ruleId: string;
  enabled: boolean;
  requirement: StrategyRuleRequirement;
  timeframeRole?: string;
  parameters: JsonObject;
  confidenceContribution: number;
  executionOrder: number;
  missingEvidenceBehavior?: MissingEvidenceBehavior;
};

export type StrategyValidationMetadata = {
  schemaVersion: '1.0.0';
  status: 'DRAFT' | 'VALIDATED' | 'DEPRECATED';
  description: string;
  tags: string[];
  author?: string;
};

export type DeclarativeStrategyDefinition = {
  id: string;
  name: string;
  version: string;
  tradingStyle: StrategyTradingStyle;
  supportedSymbols: string[];
  supportedAssetClasses: string[];
  timeframeRoles: Record<string, string>;
  rules: DeclarativeStrategyRule[];
  validation: StrategyValidationMetadata;
  directionConfiguration?: DirectionConfiguration;
};

export type StrategyDefinitionValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type StrategyDefinitionValidationResult = {
  valid: boolean;
  issues: StrategyDefinitionValidationIssue[];
};

export type CompiledStrategyDefinition = StrategyDefinition & {
  compiledStrategyId: string;
  name: string;
  tradingStyle: StrategyTradingStyle;
  supportedSymbols: string[];
  supportedAssetClasses: string[];
  timeframeRoles: Record<string, string>;
  validation: StrategyValidationMetadata;
  sourceDefinitionVersion: string;
  ruleMetadata: Record<string, { name: string; version: string }>;
  directionConfiguration?: DirectionConfiguration;
};
