import type { DisplacementObservation, MarketContext } from '../../contracts.ts';
import type { CompositionRule, RuleEvaluationResult, StrategyDefinition } from '../composition-types.ts';
import { configuredContribution, configuredTimeframe, findObservation } from '../rule-helpers.ts';

export class DisplacementRule implements CompositionRule {
  readonly metadata = Object.freeze({ id: 'displacement', name: 'Displacement Rule', version: '1.0.0', deterministic: true as const, supportedStrategies: ['*'], description: 'Matches when a successful Displacement observation reports displacement.' });
  evaluate(strategy: StrategyDefinition, context: MarketContext): RuleEvaluationResult {
    const timeframe = configuredTimeframe(context, strategy.ruleConfiguration?.[this.metadata.id]);
    const found = findObservation(context, 'displacement', timeframe);
    if (!found) return this.result(strategy, 'NOT_EVALUATED', false, [], `No Displacement observation is available for ${timeframe ?? 'the requested timeframe'}.`, ['Displacement observation is missing.']);
    if (found.result.status === 'ERROR') return this.result(strategy, 'ERROR', false, [found.reference], 'The Displacement observation contains an error.', found.result.warnings);
    if (found.result.status === 'INSUFFICIENT_DATA') return this.result(strategy, 'NOT_EVALUATED', false, [found.reference], 'The Displacement observation has insufficient data.', found.result.warnings);
    if (found.result.payload === null) return this.result(strategy, 'NOT_EVALUATED', false, [found.reference], 'The Displacement observation has no payload.', ['Displacement observation payload is missing.']);
    const matched = (found.result.payload as DisplacementObservation).displacementDetected === true;
    return this.result(strategy, matched ? 'MATCHED' : 'FAILED', matched, [found.reference], matched ? 'Displacement was observed.' : 'No displacement was observed.', found.result.warnings);
  }
  private result(strategy: StrategyDefinition, status: RuleEvaluationResult['status'], matched: boolean, evidenceReferences: RuleEvaluationResult['evidenceReferences'], explanation: string, warnings: string[]): RuleEvaluationResult {
    const requirement = strategy.ruleRequirements?.[this.metadata.id];
    return { ruleId: this.metadata.id, ruleVersion: this.metadata.version, status, matched, confidenceContribution: configuredContribution(strategy.ruleConfiguration?.[this.metadata.id], matched), evidenceReferences, explanation, warnings: [...warnings], ...(requirement ? { requirement } : {}) };
  }
}
