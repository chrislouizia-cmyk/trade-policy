import type {StrategyProfile,TimeframeLayer,TimeframeRole} from '../types/trade';
import { isMarketDataTimeframe } from './market-data.ts';

const definitions:Array<[TimeframeRole,keyof StrategyProfile]>=[['MACRO','macroTimeframe'],['TREND','trendTimeframe'],['CONFIRMATION','confirmationTimeframe'],['ENTRY','entryTimeframe'],['TRIGGER','triggerTimeframe']];

function normalizeTimeframe(value: string | undefined | null): string {
  if (typeof value !== 'string') return 'Not configured';
  const trimmed = value.trim();
  return trimmed || 'Not configured';
}

export function strategyTimeframeLayers(strategy:StrategyProfile):TimeframeLayer[]{
  return definitions.map(([role, key]) => ({
    role,
    timeframe: normalizeTimeframe(typeof strategy[key] === 'string' ? strategy[key] : undefined),
  }));
}

export function strategyTimeframeContext(strategy:StrategyProfile):string{
  const layers = strategyTimeframeLayers(strategy);
  if (layers.length === 0) return '';
  return `Trade Police checks ${layers.map(({ role, timeframe }) => `${role.toLowerCase()} ${timeframe}`).join(' · ')} against your saved rules.`;
}

export function strategyTimeframes(strategy:StrategyProfile):string[]{
  return [...new Set(strategyTimeframeLayers(strategy)
    .map((layer) => layer.timeframe)
    .filter((timeframe) => timeframe !== 'Not configured'))];
}

export function supportedMarketTimeframesForStrategy(strategy: StrategyProfile): string[] {
  return [...new Set(strategyTimeframes(strategy).filter((timeframe) => isMarketDataTimeframe(timeframe)))];
}
