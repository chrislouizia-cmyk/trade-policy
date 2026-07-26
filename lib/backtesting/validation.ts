import type { BacktestDataset, ClassificationCriteria, ExecutableRule, ExecutableStrategy, SimulationConfiguration } from './types.ts';

export const DEFAULT_CLASSIFICATION_CRITERIA: ClassificationCriteria = Object.freeze({
  robustMinimumTrades: 500,
  robustMinimumOutOfSampleProfitFactor: 1.1,
  maximumDrawdownR: 25,
  maximumProfitConcentration: .5,
  minimumOutOfSampleTrades: 100,
  substantialProfitFactorChange: .5,
});

function positiveInteger(value: number, label: string, issues: string[]): void {
  if (!Number.isInteger(value) || value < 1) issues.push(`${label} must be a positive integer.`);
}
function validateRule(rule: ExecutableRule, issues: string[]): void {
  if (!rule.id) issues.push('Every rule requires an ID.');
  if (rule.type === 'EMA_RELATION' || rule.type === 'SMA_RELATION') { positiveInteger(rule.fastPeriod, `${rule.id}.fastPeriod`, issues); positiveInteger(rule.slowPeriod, `${rule.id}.slowPeriod`, issues); }
  if (['CLOSE_VS_EMA', 'CLOSE_VS_SMA', 'VOLUME_VS_SMA', 'ATR_THRESHOLD'].includes(rule.type)) positiveInteger((rule as { period: number }).period, `${rule.id}.period`, issues);
  if (rule.type === 'BREAKOUT' || rule.type === 'PULLBACK_AFTER_BREAKOUT') positiveInteger(rule.lookback, `${rule.id}.lookback`, issues);
  if (rule.type === 'PULLBACK_AFTER_BREAKOUT') positiveInteger(rule.maximumBarsSinceBreakout, `${rule.id}.maximumBarsSinceBreakout`, issues);
  if (rule.type === 'MIN_BODY_TO_RANGE' && (rule.minimumRatio < 0 || rule.minimumRatio > 1)) issues.push(`${rule.id}.minimumRatio must be between zero and one.`);
  if (rule.type === 'SESSION' && (![rule.startUtcMinute, rule.endUtcMinute].every((value) => Number.isInteger(value) && value >= 0 && value <= 1_440))) issues.push(`${rule.id} session minutes must be from 0 through 1440.`);
}

export function validateBacktestInputs(dataset: BacktestDataset, strategy: ExecutableStrategy, configuration: SimulationConfiguration, splitFraction: number): readonly string[] {
  const issues: string[] = [];
  if (!dataset.symbol || !dataset.timeframe || !dataset.source || !dataset.timezone) issues.push('Dataset metadata is incomplete.');
  if (!dataset.candles.length) issues.push('Dataset contains no candles.');
  let previous = -Infinity;
  for (const candle of dataset.candles) {
    const timestamp = Date.parse(candle.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= previous) issues.push('Dataset candle timestamps must be valid, unique, and strictly chronological.');
    if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) issues.push(`Malformed candle at ${candle.timestamp}.`);
    previous = timestamp;
  }
  if (!strategy.id || !strategy.name || !strategy.version) issues.push('Strategy identity is incomplete.');
  if (!strategy.entryRules.length) issues.push('Strategy requires at least one entry rule.');
  const ids = [...strategy.entryRules, ...strategy.forbiddenRules].map((rule) => rule.id);
  if (new Set(ids).size !== ids.length) issues.push('Strategy rule IDs must be unique.');
  for (const rule of [...strategy.entryRules, ...strategy.forbiddenRules]) validateRule(rule, issues);
  if (!Number.isInteger(strategy.minimumRequiredConfirmations) || strategy.minimumRequiredConfirmations < 0) issues.push('minimumRequiredConfirmations must be a non-negative integer.');
  if (splitFraction <= 0 || splitFraction >= 1) issues.push('In-sample fraction must be between zero and one.');
  if (configuration.costs.commissionR < 0 || configuration.costs.spreadPrice < 0 || configuration.costs.slippagePrice < 0) issues.push('Costs cannot be negative.');
  positiveInteger(configuration.maximumHoldingBars, 'maximumHoldingBars', issues);
  return Object.freeze([...new Set(issues)]);
}
