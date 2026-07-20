import { DEFAULT_STRATEGY_PROFILE } from '../types/trade.ts';
import type { AIBehaviorProfile, EvidenceKey, StopLimit, StrategyProfile } from '@/types/trade';

export type StrategyPolicy={
  instruments:string[];timeframes:{macro?:string;trend:string;confirmation:string;entry:string;trigger?:string};minimumRR:number;maximumRisk:number;
  confidenceThreshold:number;requiredConfirmations:EvidenceKey[];optionalConfirmations:EvidenceKey[];
  evidenceWeights:Partial<Record<EvidenceKey,number>>;requireTrendAlignment:boolean;allowedSessions:string[];
  stopPolicy:StopLimit[];allowedSetups:string[]|null;forbiddenSetups:string[];tradeLimits:{strategy:number;byInstrument:Record<string,number>};avoidHighImpactNews:boolean;
};

const evidenceKeys:EvidenceKey[]=['h4TrendAligned','h1TrendAligned','structurePattern','liquiditySweep','chochConfirmed','bosConfirmed','orderBlock','fairValueGap','retestConfirmed'];
const defaultAI=DEFAULT_STRATEGY_PROFILE.aiBehavior as AIBehaviorProfile;

export function normalizeStrategyProfile(strategy:StrategyProfile):StrategyProfile{
  return {...strategy,engineVersion:strategy.engineVersion??(strategy.macroTimeframe&&strategy.triggerTimeframe?2:1),aiBehavior:{...defaultAI,...strategy.aiBehavior}};
}

export class StrategyConfigurationError extends Error{
  missingFields:string[];
  constructor(fields:string[]){super(`Active strategy configuration is incomplete: ${fields.join(', ')}.`);this.name='StrategyConfigurationError';this.missingFields=fields;}
}

export function normalizeStrategyPolicy(strategy:StrategyProfile):StrategyPolicy{
  strategy=normalizeStrategyProfile(strategy);
  const missing:string[]=[];
  if(!strategy.instruments?.length)missing.push('enabled instruments');
  if(!strategy.trendTimeframe)missing.push('trend timeframe');
  if(!strategy.confirmationTimeframe)missing.push('confirmation timeframe');
  if(!strategy.entryTimeframe)missing.push('entry timeframe');
  if(!Number.isFinite(strategy.minimumRR)||strategy.minimumRR<=0)missing.push('minimum RR');
  if(!Number.isFinite(strategy.maximumRiskPercent)||strategy.maximumRiskPercent<=0)missing.push('maximum risk per trade');
  const threshold=Number(strategy.aiBehavior?.confidenceThreshold);
  if(!Number.isFinite(threshold)||threshold<0||threshold>100)missing.push('confidence threshold');
  const weights=Object.fromEntries(Object.entries(strategy.evidenceWeights??{}).filter(([key,value])=>evidenceKeys.includes(key as EvidenceKey)&&Number(value)>0)) as Partial<Record<EvidenceKey,number>>;
  if(!Object.keys(weights).length)missing.push('evidence weights');
  if(!strategy.allowedSessions?.length)missing.push('allowed sessions');
  if(!Number.isFinite(strategy.maximumTradesPerDay)||strategy.maximumTradesPerDay<1)missing.push('maximum trades per day');
  const stopPolicy=strategy.stopLimitSettings??[];
  for(const instrument of strategy.instruments??[]){
    const stop=stopPolicy.find(item=>item.instrument===instrument);
    if(!stop)missing.push(`stop policy for ${instrument}`);
    else if(['ATR','STRUCTURAL'].includes(stop.method))missing.push(`supported numeric stop method for ${instrument}`);
    else if(!(Number(stop.maximumValue)>0)||Number(stop.minimumValue??0)<0||Number(stop.preferredValue??0)<0)missing.push(`valid stop range for ${instrument}`);
  }
  if(missing.length)throw new StrategyConfigurationError(missing);
  const configured=Object.keys(weights) as EvidenceKey[];
  const required=[...new Set((strategy.requiredEvidence??[]).filter(key=>configured.includes(key)))];
  return {instruments:strategy.instruments,timeframes:{macro:strategy.macroTimeframe,trend:strategy.trendTimeframe,confirmation:strategy.confirmationTimeframe,entry:strategy.entryTimeframe,trigger:strategy.triggerTimeframe},minimumRR:strategy.minimumRR,maximumRisk:strategy.maximumRiskPercent,confidenceThreshold:threshold,requiredConfirmations:required,optionalConfirmations:configured.filter(key=>!required.includes(key)),evidenceWeights:weights,requireTrendAlignment:strategy.requireTrendAlignment,allowedSessions:strategy.allowedSessions,stopPolicy,allowedSetups:strategy.rejectUnlistedSetups?(strategy.preferredSetups??[]):null,forbiddenSetups:[],tradeLimits:{strategy:strategy.maximumTradesPerDay,byInstrument:strategy.instrumentTradeLimits??{}},avoidHighImpactNews:strategy.avoidHighImpactNews};
}

export function weightedConfidence(evidence:Record<EvidenceKey,{value:boolean}>|Record<EvidenceKey,boolean>,policy:StrategyPolicy){
  const entries=Object.entries(policy.evidenceWeights) as [EvidenceKey,number][];
  const total=entries.reduce((sum,[,weight])=>sum+weight,0);
  if(total<=0)throw new StrategyConfigurationError(['evidence weights']);
  const earned=entries.reduce((sum,[key,weight])=>sum+((typeof evidence[key]==='boolean'?evidence[key]:(evidence[key] as {value:boolean})?.value)?weight:0),0);
  return Math.round(earned/total*100);
}
