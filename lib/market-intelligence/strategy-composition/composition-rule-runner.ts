import type { MarketContext } from '../contracts.ts';
import type { CompositionRuleRegistry } from './composition-rule-registry.ts';
import type { EvidenceReference, RuleEvaluationResult, StrategyContext, StrategyDefinition } from './composition-types.ts';

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
function freezeResult(result: RuleEvaluationResult): RuleEvaluationResult {
  result.evidenceReferences.forEach((reference) => { Object.freeze(reference.evidenceIds); Object.freeze(reference); });
  Object.freeze(result.evidenceReferences); Object.freeze(result.warnings); return Object.freeze(result);
}
function freezeStrategyContext(context: StrategyContext): StrategyContext {
  context.ruleResults.forEach(freezeResult); Object.freeze(context.ruleResults);
  Object.values(context.evidenceMap).forEach((references) => { references.forEach((reference) => { Object.freeze(reference.evidenceIds); Object.freeze(reference); }); Object.freeze(references); });
  Object.freeze(context.evidenceMap); Object.freeze(context.matchedRuleIds); Object.freeze(context.failedRuleIds); Object.freeze(context.warnings); Object.freeze(context.confidenceContributions); Object.freeze(context.executionSummary);
  return Object.freeze(context);
}

export class CompositionRuleRunner {
  readonly #registry: CompositionRuleRegistry;
  constructor(registry: CompositionRuleRegistry) { this.#registry = registry; }

  execute(strategy: StrategyDefinition, marketContext: MarketContext, ruleIds?: readonly string[]): StrategyContext {
    if (!marketContext.requestedAt || !Number.isFinite(Date.parse(marketContext.requestedAt))) throw new Error('MarketContext requestedAt is required for deterministic strategy composition.');
    const selectedIds = ruleIds ?? strategy.ruleExecutionOrder;
    const rules = selectedIds ? selectedIds.map((id) => this.#registry.get(id) ?? (() => { throw new Error(`Composition rule is not registered: ${id}`); })()) : [...this.#registry.list()];
    const results = rules.map((rule): RuleEvaluationResult => {
      try { return rule.evaluate(strategy, marketContext); }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown composition rule failure.';
        return { ruleId: rule.metadata.id, ruleVersion: rule.metadata.version, status: 'ERROR', matched: false, confidenceContribution: 0, evidenceReferences: [], explanation: `Rule execution failed: ${message}`, warnings: [message] };
      }
    });
    const evidenceMap: Record<string, EvidenceReference[]> = {};
    for (const result of results) evidenceMap[result.ruleId] = result.evidenceReferences.map((reference) => ({ ...reference, evidenceIds: [...reference.evidenceIds] }));
    const matchedRuleIds = results.filter((result) => result.matched).map((result) => result.ruleId);
    const failedRuleIds = results.filter((result) => !result.matched).map((result) => result.ruleId);
    const totalNotEvaluated = results.filter((result) => result.status === 'NOT_EVALUATED').length;
    const totalErrors = results.filter((result) => result.status === 'ERROR').length;
    const confidenceContributions = Object.fromEntries(results.map((result) => [result.ruleId, result.confidenceContribution]));
    return freezeStrategyContext({
      contextId: `strategy-context:${strategy.id}:${strategy.version}:${marketContext.contextId}`,
      contextVersion: '1.0.0', strategyId: strategy.id, strategyVersion: strategy.version, marketContextId: marketContext.contextId,
      executionTimestamp: marketContext.requestedAt, ruleResults: results.map((result) => ({ ...result, evidenceReferences: result.evidenceReferences.map((reference) => ({ ...reference, evidenceIds: [...reference.evidenceIds] })), warnings: [...result.warnings] })),
      evidenceMap, matchedRuleIds, failedRuleIds, warnings: unique([...marketContext.warnings, ...results.flatMap((result) => result.warnings)]), confidenceContributions,
      totalMatched: matchedRuleIds.length, totalFailed: failedRuleIds.length,
      executionSummary: { totalRules: results.length, totalMatched: matchedRuleIds.length, totalFailed: failedRuleIds.length, totalNotEvaluated, totalErrors },
    });
  }
}
