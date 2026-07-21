import type { MarketContext, RetestObservation } from '../../contracts.ts';
import type { CompositionRule, RuleEvaluationResult, StrategyDefinition } from '../composition-types.ts';
import { configuredContribution, configuredTimeframe, findObservation } from '../rule-helpers.ts';

export class RetestRule implements CompositionRule {
  readonly metadata = Object.freeze({ id: 'retest', name: 'Retest Rule', version: '1.0.0', deterministic: true as const, supportedStrategies: ['*'], description: 'Matches when a successful Retest observation reports a retest.' });
  evaluate(strategy: StrategyDefinition, context: MarketContext): RuleEvaluationResult {
    const timeframe = configuredTimeframe(context, strategy.ruleConfiguration?.[this.metadata.id]);
    const found = findObservation(context, 'retest', timeframe);
    if (!found) return this.result(strategy, 'NOT_EVALUATED', false, [], `No Retest observation is available for ${timeframe ?? 'the requested timeframe'}.`, ['Retest observation is missing.']);
    if (found.result.status === 'ERROR') return this.result(strategy, 'ERROR', false, [found.reference], 'The Retest observation contains an error.', found.result.warnings);
    if (found.result.status === 'INSUFFICIENT_DATA') return this.result(strategy, 'NOT_EVALUATED', false, [found.reference], 'The Retest observation has insufficient data.', found.result.warnings);
    if (found.result.payload === null) return this.result(strategy, 'NOT_EVALUATED', false, [found.reference], 'The Retest observation has no payload.', ['Retest observation payload is missing.']);
    const matched = (found.result.payload as RetestObservation).retestDetected === true;
    return this.result(strategy, matched ? 'MATCHED' : 'FAILED', matched, [found.reference], matched ? 'A retest was observed.' : 'No retest was observed.', found.result.warnings);
  }
  private result(strategy: StrategyDefinition, status: RuleEvaluationResult['status'], matched: boolean, evidenceReferences: RuleEvaluationResult['evidenceReferences'], explanation: string, warnings: string[]): RuleEvaluationResult {
    const requirement = strategy.ruleRequirements?.[this.metadata.id];
    return { ruleId: this.metadata.id, ruleVersion: this.metadata.version, status, matched, confidenceContribution: configuredContribution(strategy.ruleConfiguration?.[this.metadata.id], matched), evidenceReferences, explanation, warnings: [...warnings], ...(requirement ? { requirement } : {}) };
  }
}
