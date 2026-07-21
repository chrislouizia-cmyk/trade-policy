import type { TrendObservation } from '../../contracts.ts';
import type { CompositionRule, RuleEvaluationResult, StrategyDefinition } from '../composition-types.ts';
import { configuredContribution, configuredTimeframe, findObservation } from '../rule-helpers.ts';
import type { MarketContext } from '../../contracts.ts';

export class TrendAlignmentRule implements CompositionRule {
  readonly metadata = Object.freeze({ id: 'trend-alignment', name: 'Trend Alignment Rule', version: '1.0.0', deterministic: true as const, supportedStrategies: ['*'], description: 'Matches a successful Trend observation against the strategy-required trend.' });
  evaluate(strategy: StrategyDefinition, context: MarketContext): RuleEvaluationResult {
    const timeframe = configuredTimeframe(context, strategy.ruleConfiguration?.[this.metadata.id]);
    const found = findObservation(context, 'trend', timeframe);
    const configuredTrend = strategy.ruleConfiguration?.[this.metadata.id]?.requiredTrend;
    const requiredTrend = configuredTrend === 'BULLISH' || configuredTrend === 'BEARISH' || configuredTrend === 'RANGE' ? configuredTrend : strategy.requiredTrend;
    if (!requiredTrend) return this.result(strategy, 'NOT_EVALUATED', false, [], 'The strategy does not define a required trend.', ['Required trend is missing.']);
    if (!found) return this.result(strategy, 'NOT_EVALUATED', false, [], `No Trend observation is available for ${timeframe ?? 'the requested timeframe'}.`, ['Trend observation is missing.']);
    if (found.result.status === 'ERROR') return this.result(strategy, 'ERROR', false, [found.reference], 'The Trend observation contains an error.', found.result.warnings);
    if (found.result.status === 'INSUFFICIENT_DATA') return this.result(strategy, 'NOT_EVALUATED', false, [found.reference], 'The Trend observation has insufficient data.', found.result.warnings);
    if (found.result.payload === null) return this.result(strategy, 'NOT_EVALUATED', false, [found.reference], 'The Trend observation has no payload.', ['Trend observation payload is missing.']);
    const actual = (found.result.payload as TrendObservation).direction;
    const matched = actual === requiredTrend;
    return this.result(strategy, matched ? 'MATCHED' : 'FAILED', matched, [found.reference], `Required trend ${requiredTrend}; observed ${actual}.`, found.result.warnings);
  }
  private result(strategy: StrategyDefinition, status: RuleEvaluationResult['status'], matched: boolean, evidenceReferences: RuleEvaluationResult['evidenceReferences'], explanation: string, warnings: string[]): RuleEvaluationResult {
    const requirement = strategy.ruleRequirements?.[this.metadata.id];
    return { ruleId: this.metadata.id, ruleVersion: this.metadata.version, status, matched, confidenceContribution: configuredContribution(strategy.ruleConfiguration?.[this.metadata.id], matched), evidenceReferences, explanation, warnings: [...warnings], ...(requirement ? { requirement } : {}) };
  }
}
