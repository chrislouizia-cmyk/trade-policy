import type { StopLimit, StrategyProfile } from '../types/trade.ts';
import { METHODOLOGY_LIBRARY, createPersistedV2RuleTree, type RuleSelection } from './strategy-builder-v2.ts';
import { v2StateToPersistedStrategy, type V2Persisted } from './strategy-builder-v2-persistence.ts';

export const GBPUSD_HTF_STRATEGY_NAME = 'GBPUSD HTF Liquidity & Structure v1';
export const GOLD_HTF_STRATEGY_NAME = 'Gold HTF Liquidity Expansion v1';

const definitions = new Map(METHODOLOGY_LIBRARY.flatMap((methodology) => methodology.rules).map((rule) => [rule.key, rule]));

function selection(key:string, requirement:RuleSelection['requirement'], timeframe:string, group:RuleSelection['group']='ALL'):RuleSelection {
  const definition=definitions.get(key);
  if(!definition)throw new Error(`HTF strategy rule is not registered: ${key}`);
  return {key,label:definition.label,capability:definition.capability,requirement,timeframe,group,description:definition.description};
}

export function htfLiquidityRuleSelections():RuleSelection[] {
  return [
    selection('liquidity-sweep','REQUIRED','H1'),
    selection('displacement','REQUIRED','M15'),
    selection('choch','REQUIRED','M15'),
    selection('bos','REQUIRED','M15'),
    selection('retest','REQUIRED','M15'),
    selection('fair-value-gap','OPTIONAL','M15','ANY'),
    selection('order-block','OPTIONAL','M15','ANY'),
    selection('engulfing','OPTIONAL','M5','ANY'),
    selection('premium-discount','OPTIONAL','H4','ANY'),
    selection('trend-alignment','OPTIONAL','H4','ANY'),
    selection('session-open','OPTIONAL','M15','ANY'),
    selection('pullback-entry','OPTIONAL','M5','ANY'),
    selection('liquidity-run','OPTIONAL','H1','ANY'),
  ];
}

export function htfStopLimits(instrument:'GBPUSD'|'GBPJPY'|'XAUUSD'):StopLimit[] {
  if(instrument==='XAUUSD')return [{instrument,method:'POINTS',minimumValue:1200,preferredValue:2400,maximumValue:3600}];
  if(instrument==='GBPJPY')return [{instrument,method:'PIPS',minimumValue:15,preferredValue:35,maximumValue:60}];
  return [{instrument,method:'PIPS',minimumValue:10,preferredValue:30,maximumValue:50}];
}

export function buildHtfLiquidityStrategy(baseProfile:StrategyProfile,instrument:'GBPUSD'|'GBPJPY'|'XAUUSD'):V2Persisted {
  const rules=htfLiquidityRuleSelections();
  const stopLimits=htfStopLimits(instrument);
  const profile:StrategyProfile={
    ...structuredClone(baseProfile),
    name:instrument==='XAUUSD'?GOLD_HTF_STRATEGY_NAME:instrument==='GBPUSD'?GBPUSD_HTF_STRATEGY_NAME:baseProfile.name,
    instruments:[instrument],marketTypes:[instrument==='XAUUSD'?'METALS':'FOREX'],
    macroTimeframe:'D1',trendTimeframe:'H4',confirmationTimeframe:'H1',entryTimeframe:'M15',triggerTimeframe:'M5',
    minimumRR:2,preferredRR:Math.max(3,Number(baseProfile.preferredRR??3)),maximumRiskPercent:.5,
    requireTrendAlignment:false,
    stopLimitSettings:stopLimits,stopLimits:Object.fromEntries(stopLimits.map((limit)=>[limit.instrument,limit.maximumValue])),
  };
  const persisted=v2StateToPersistedStrategy(profile,{
    name:profile.name,instruments:[instrument],sessions:[...(profile.allowedSessions??[])],contextTimeframe:'D1',executionTimeframe:'M15',
    methodologyIds:['smc','ict','supply-demand','price-action','trend-following'],ruleSelections:rules,ruleTree:createPersistedV2RuleTree(rules),
    riskPercent:.5,minimumRR:2,stopLogic:{kind:'STOP_LIMITS',limits:stopLimits},direction:'BOTH',
  });
  persisted.profile.rules=[...persisted.rules];
  return persisted;
}
