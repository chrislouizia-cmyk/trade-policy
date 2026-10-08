import type { StrategyRule } from '../types/trade.ts';

export type StrategyRuleInput = Omit<StrategyRule, 'ruleKey'> & { ruleKey?: string | null };

export type StrategyRulePersistenceResult = {
  rules: StrategyRule[];
  issues: string[];
  persistable: boolean;
};

function semanticRuleKey(label: string): string {
  return label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function normalizePersistableStrategyRules(input: readonly StrategyRuleInput[]): StrategyRulePersistenceResult {
  const reserved = new Set(input.map((rule) => typeof rule.ruleKey === 'string' ? rule.ruleKey.trim() : '').filter(Boolean));
  const assigned = new Set<string>();
  const issues: string[] = [];
  const rules = input.map((rule, index): StrategyRule => {
    const existing = typeof rule.ruleKey === 'string' ? rule.ruleKey.trim() : '';
    let ruleKey = existing;
    if (!ruleKey) {
      const candidate = semanticRuleKey(rule.label.trim());
      if (candidate) {
        ruleKey = candidate;
        let suffix = 2;
        while (reserved.has(ruleKey) || assigned.has(ruleKey)) ruleKey = `${candidate}-${suffix++}`;
      }
    }
    if (!ruleKey) issues.push(`Rule ${index + 1} needs a label before it can be saved.`);
    if (ruleKey && assigned.has(ruleKey)) issues.push(`Rule key "${ruleKey}" is duplicated.`);
    if (ruleKey) assigned.add(ruleKey);
    return { ...rule, ruleKey } as StrategyRule;
  });
  return { rules, issues, persistable: issues.length === 0 && rules.every((rule) => Boolean(rule.ruleKey.trim())) };
}

export function strategyRulePersistenceRows(rules: readonly StrategyRule[]) {
  return rules.map((rule, index) => {
    const ruleKey = rule.ruleKey.trim();
    if (!ruleKey) throw new Error(`Persistence invariant failed: strategy rule ${index + 1} has no rule_key.`);
    return {
      rule_key: ruleKey,
      label: rule.label,
      enabled: rule.enabled,
      mandatory: rule.mandatory,
      weight: rule.weight,
      minimum_confidence: rule.minimumConfidence,
      timeframe_role: rule.timeframeRole,
      evaluation_mode: rule.evaluationMode ?? 'AUTOMATIC',
      sort_order: index,
    };
  });
}
