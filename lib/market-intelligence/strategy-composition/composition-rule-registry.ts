import type { CompositionRule, RuleEvaluationResult, StrategyDefinition } from './composition-types.ts';
import type { MarketContext } from '../contracts.ts';

export class CompositionRuleRegistry {
  readonly #rules = new Map<string, CompositionRule>();

  register(rule: CompositionRule): this {
    if (this.#rules.has(rule.metadata.id)) throw new Error(`Composition rule already registered: ${rule.metadata.id}`);
    this.#rules.set(rule.metadata.id, rule);
    return this;
  }

  unregister(id: string): boolean { return this.#rules.delete(id); }
  get(id: string): CompositionRule | undefined { return this.#rules.get(id); }
  list(): readonly CompositionRule[] { return Object.freeze([...this.#rules.values()]); }

  execute(id: string, strategy: StrategyDefinition, context: MarketContext): RuleEvaluationResult {
    const rule = this.get(id);
    if (!rule) throw new Error(`Composition rule is not registered: ${id}`);
    return rule.evaluate(strategy, context);
  }
}
