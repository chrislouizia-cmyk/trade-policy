import type {StrategyProfile,TimeframeLayer,TimeframeRole} from '@/types/trade';

const definitions:Array<[TimeframeRole,keyof StrategyProfile]>=[['MACRO','macroTimeframe'],['TREND','trendTimeframe'],['CONFIRMATION','confirmationTimeframe'],['ENTRY','entryTimeframe'],['TRIGGER','triggerTimeframe']];

export function strategyTimeframeLayers(strategy:StrategyProfile):TimeframeLayer[]{
  return definitions.flatMap(([role,key])=>{const timeframe=strategy[key];return typeof timeframe==='string'&&timeframe.trim()?[{role,timeframe}]:[]});
}

export function strategyTimeframes(strategy:StrategyProfile):string[]{return [...new Set(strategyTimeframeLayers(strategy).map(layer=>layer.timeframe))]}
