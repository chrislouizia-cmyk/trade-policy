import { CompositionRuleRegistry } from './composition-rule-registry.ts';
import { DisplacementRule } from './rules/displacement-rule.ts';
import { RetestRule } from './rules/retest-rule.ts';
import { TrendAlignmentRule } from './rules/trend-alignment-rule.ts';

export function createCompositionRuleRegistry(): CompositionRuleRegistry {
  return new CompositionRuleRegistry().register(new TrendAlignmentRule()).register(new RetestRule()).register(new DisplacementRule());
}
