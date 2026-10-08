import type { ExecutableRule, ExecutableStrategy, StrategyAdaptationIssue, StrategyAdaptationResult, StrategyDnaInput, StrategyDnaRuleInput } from './types.ts';

export const STRATEGY_RULE_SUPPORT = Object.freeze({
  ema_relation: 'SUPPORTED',
  close_vs_ema: 'SUPPORTED',
  price_cross_level: 'SUPPORTED',
  breakout: 'SUPPORTED',
  pullback_after_breakout: 'PARTIALLY_SUPPORTED',
  candle_direction: 'SUPPORTED',
  minimum_body_ratio: 'SUPPORTED',
  volume_above_average: 'SUPPORTED',
  atr_threshold: 'SUPPORTED',
  session: 'SUPPORTED',
  day_of_week: 'SUPPORTED',
  minimum_rr: 'SUPPORTED',
  legacy_trend_alignment: 'SUPPORTED',
  legacy_retest: 'SUPPORTED',
  legacy_displacement: 'SUPPORTED',
  fair_value_gap: 'UNSUPPORTED',
  order_block: 'UNSUPPORTED',
  liquidity_sweep: 'UNSUPPORTED',
  market_structure_shift: 'UNSUPPORTED',
  break_of_structure: 'UNSUPPORTED',
  change_of_character: 'UNSUPPORTED',
} as const);

const unsupported = new Set(['fair_value_gap', 'order_block', 'liquidity_sweep', 'market_structure_shift', 'break_of_structure', 'change_of_character']);
const partiallySupported = new Set(['pullback_after_breakout']);
const numberParameter = (rule: StrategyDnaRuleInput, key: string): number => {
  const value = Number(rule.parameters?.[key]);
  if (!Number.isFinite(value)) throw new Error(`${rule.concept} requires numeric parameter "${key}".`);
  return value;
};
const relation = (rule: StrategyDnaRuleInput, key = 'relation'): 'ABOVE' | 'BELOW' => {
  const value = String(rule.parameters?.[key] ?? '').toUpperCase();
  if (value !== 'ABOVE' && value !== 'BELOW') throw new Error(`${rule.concept} requires ${key}=ABOVE or BELOW.`);
  return value;
};

function adaptRule(rule: StrategyDnaRuleInput): ExecutableRule {
  const base = { id: rule.id, required: rule.required };
  switch (rule.concept) {
    case 'ema_relation': return { ...base, type: 'EMA_RELATION', fastPeriod: numberParameter(rule, 'fastPeriod'), slowPeriod: numberParameter(rule, 'slowPeriod'), relation: relation(rule) };
    case 'close_vs_ema': return { ...base, type: 'CLOSE_VS_EMA', period: numberParameter(rule, 'period'), relation: relation(rule) };
    case 'price_cross_level': return { ...base, type: 'PRICE_CROSS_LEVEL', level: numberParameter(rule, 'level'), direction: relation(rule, 'direction') };
    case 'breakout': return { ...base, type: 'BREAKOUT', lookback: numberParameter(rule, 'lookback'), direction: relation(rule, 'direction') };
    case 'pullback_after_breakout': return { ...base, type: 'PULLBACK_AFTER_BREAKOUT', lookback: numberParameter(rule, 'lookback'), maximumBarsSinceBreakout: numberParameter(rule, 'maximumBarsSinceBreakout'), direction: relation(rule, 'direction') };
    case 'candle_direction': {
      const direction = String(rule.parameters?.direction).toUpperCase();
      if (direction !== 'BULLISH' && direction !== 'BEARISH') throw new Error('candle_direction requires BULLISH or BEARISH.');
      return { ...base, type: 'CANDLE_DIRECTION', direction };
    }
    case 'minimum_body_ratio': return { ...base, type: 'MIN_BODY_TO_RANGE', minimumRatio: numberParameter(rule, 'minimumRatio') };
    case 'volume_above_average': return { ...base, type: 'VOLUME_VS_SMA', period: numberParameter(rule, 'period'), multiplier: numberParameter(rule, 'multiplier') };
    case 'atr_threshold': return { ...base, type: 'ATR_THRESHOLD', period: numberParameter(rule, 'period'), relation: relation(rule), threshold: numberParameter(rule, 'threshold') };
    case 'session': return { ...base, type: 'SESSION', startUtcMinute: numberParameter(rule, 'startUtcMinute'), endUtcMinute: numberParameter(rule, 'endUtcMinute') };
    case 'day_of_week': {
      const days = rule.parameters?.allowedDaysUtc;
      if (!Array.isArray(days) || !days.every((day) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6)) throw new Error('day_of_week requires allowedDaysUtc values from 0 through 6.');
      return { ...base, type: 'DAY_OF_WEEK', allowedDaysUtc: days.map(Number) };
    }
    case 'minimum_rr': return { ...base, type: 'MINIMUM_RR', minimum: numberParameter(rule, 'minimum') };
    case 'legacy_trend_alignment': return { ...base, type: 'SMA_RELATION', fastPeriod: 10, slowPeriod: 24, relation: 'ABOVE', closeMustConfirmSlow: true };
    case 'legacy_retest': return { ...base, type: 'LEGACY_RETEST', atrPeriod: 14, lookback: 7, toleranceAtrMultiple: .35, tolerancePriceMultiple: .0002, trendFastPeriod: 10, trendSlowPeriod: 24 };
    case 'legacy_displacement': return { ...base, type: 'LEGACY_DISPLACEMENT', atrPeriod: 14, atrMultiple: 1.1, bodyRangeRatio: .65 };
    default: throw new Error(`Unsupported Strategy DNA concept: ${rule.concept}.`);
  }
}

export function adaptStrategyDna(input: StrategyDnaInput): StrategyAdaptationResult {
  const issues: StrategyAdaptationIssue[] = [];
  const supported: Array<{ source: StrategyDnaRuleInput; rule: ExecutableRule }> = [];
  for (const source of input.rules) {
    if (unsupported.has(source.concept)) {
      issues.push({ ruleId: source.id, concept: source.concept, support: 'UNSUPPORTED', message: `${source.concept} has no deterministic backtesting implementation.` });
      continue;
    }
    try {
      const rule = adaptRule(source);
      supported.push({ source, rule });
      if (partiallySupported.has(source.concept)) issues.push({ ruleId: source.id, concept: source.concept, support: 'PARTIALLY_SUPPORTED', message: 'Only the explicit close-break then level-retest definition is supported.' });
    } catch (error) {
      issues.push({ ruleId: source.id, concept: source.concept, support: 'UNSUPPORTED', message: error instanceof Error ? error.message : 'Rule adaptation failed.' });
    }
  }
  if (issues.some((issue) => issue.support === 'UNSUPPORTED')) return Object.freeze({ valid: false, strategy: null, issues: Object.freeze(issues) });
  const entryRules = supported.filter((item) => !item.source.forbidden).map((item) => item.rule);
  const forbiddenRules = supported.filter((item) => item.source.forbidden).map((item) => item.rule);
  const strategy: ExecutableStrategy = Object.freeze({ id: input.id, name: input.name, version: input.version, direction: input.direction.toUpperCase() as ExecutableStrategy['direction'], entryRules: Object.freeze(entryRules), forbiddenRules: Object.freeze(forbiddenRules), stopLossRule: input.stopLoss, takeProfitRule: input.takeProfit, maximumHoldingPeriod: input.maximumHoldingPeriod, minimumRequiredConfirmations: input.minimumRequiredConfirmations ?? entryRules.filter((rule) => rule.required !== false).length });
  return Object.freeze({ valid: true, strategy, issues: Object.freeze(issues) });
}
