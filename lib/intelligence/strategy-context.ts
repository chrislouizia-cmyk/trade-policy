import { strategyTimeframeLayers } from '../strategy-timeframes.ts';
import type { StrategyContextSummary } from '../../types/intelligence.ts';
import type { StrategyProfile } from '../../types/trade.ts';

export function buildStrategyContext(strategy: StrategyProfile): StrategyContextSummary {
  const rules = (strategy.rules ?? []).filter((rule) => rule.enabled);
  const layers = strategyTimeframeLayers(strategy).map((layer, index) => ({
    layer: index + 1,
    ...layer,
  }));
  const threshold = Number(strategy.aiBehavior?.confidenceThreshold);
  const maxRisk = Number(strategy.maximumRiskPercent);
  const minimumRR = Number(strategy.minimumRR);
  const missingFields: string[] = [];

  if (!strategy.id) missingFields.push('strategy id');
  if (!strategy.name?.trim()) missingFields.push('strategy name');
  if (layers.length !== 5) missingFields.push('five-layer timeframe model');
  if (!Number.isFinite(threshold)) missingFields.push('confidence threshold');
  if (!Number.isFinite(maxRisk)) missingFields.push('maximum risk percentage');
  if (!Number.isFinite(minimumRR)) missingFields.push('minimum risk-reward ratio');
  if (!strategy.allowedSessions?.length) missingFields.push('permitted sessions');

  return {
    complete: missingFields.length === 0,
    missingFields,
    strategyId: strategy.id ?? null,
    strategyName: strategy.name?.trim() || null,
    engineVersion: Number.isFinite(Number(strategy.engineVersion)) ? Number(strategy.engineVersion) : null,
    confidenceThreshold: Number.isFinite(threshold) ? threshold : null,
    fiveLayerModel: layers,
    mandatoryRuleCount: rules.filter((rule) => rule.mandatory).length,
    optionalRuleCount: rules.filter((rule) => !rule.mandatory).length,
    automaticRuleCount: rules.filter((rule) => (rule.evaluationMode ?? 'AUTOMATIC') === 'AUTOMATIC').length,
    manualRuleCount: rules.filter((rule) => rule.evaluationMode === 'MANUAL').length,
    permittedSessions: [...(strategy.allowedSessions ?? [])],
    allowedSetups: strategy.rejectUnlistedSetups ? [...(strategy.preferredSetups ?? [])] : null,
    riskPolicy: {
      maxRiskPercentage: Number.isFinite(maxRisk) ? maxRisk : null,
      minimumRiskReward: Number.isFinite(minimumRR) ? minimumRR : null,
    },
  };
}
