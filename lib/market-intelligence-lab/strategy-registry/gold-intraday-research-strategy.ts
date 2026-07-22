import type { DeclarativeStrategyDefinition } from '../../market-intelligence/strategy-definitions/strategy-definition-types.ts';
import { StrategyDefinitionCompiler } from '../../market-intelligence/strategy-definitions/strategy-definition-compiler.ts';
import { createCompositionRuleRegistry } from '../../market-intelligence/strategy-composition/bootstrap.ts';
import { ImmutableStrategyRegistry } from './immutable-strategy-registry.ts';

const definition: DeclarativeStrategyDefinition = {
  id: 'gold-intraday-research', name: 'Gold Intraday Research', version: '1.0.0', tradingStyle: 'INTRADAY', supportedSymbols: ['XAUUSD'], supportedAssetClasses: ['METALS'], timeframeRoles: { entry: 'M15' },
  rules: [
    { ruleId: 'trend-alignment', enabled: true, requirement: 'REQUIRED', timeframeRole: 'entry', parameters: { requiredTrend: 'BULLISH' }, confidenceContribution: 0.5, executionOrder: 1, missingEvidenceBehavior: 'FAIL' },
    { ruleId: 'retest', enabled: true, requirement: 'OPTIONAL', timeframeRole: 'entry', parameters: {}, confidenceContribution: 0.25, executionOrder: 2, missingEvidenceBehavior: 'FAIL' },
    { ruleId: 'displacement', enabled: true, requirement: 'OPTIONAL', timeframeRole: 'entry', parameters: {}, confidenceContribution: 0.25, executionOrder: 3, missingEvidenceBehavior: 'FAIL' },
  ],
  validation: { schemaVersion: '1.0.0', status: 'VALIDATED', description: 'Immutable long-only XAUUSD M15 strategy for the first historical engine-validation experiment.', tags: ['research', 'xauusd', 'first-experiment'], author: 'Trade Police Research' },
  directionConfiguration: { mode: 'FIXED', fixedDirection: 'BUY', conflictBehavior: 'NO_DIRECTION' },
};
export const GOLD_INTRADAY_RESEARCH_V1: DeclarativeStrategyDefinition = Object.freeze(definition);

export function createFirstExperimentStrategyRegistry(): ImmutableStrategyRegistry { const rules = createCompositionRuleRegistry(); return new ImmutableStrategyRegistry(new StrategyDefinitionCompiler(rules).compile(GOLD_INTRADAY_RESEARCH_V1)); }
