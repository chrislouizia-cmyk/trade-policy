/**
 * The only strategy representation intended for HQ operations screens.
 * It deliberately contains operational metadata and aggregate counts, never
 * private rule text, configuration, thresholds, notes, or V2 metadata.
 */
export type HQStrategySummary=Readonly<{
  id:string;
  customer:Readonly<{id:string;name:string|null}>;
  name:string;
  revision:string|null;
  engineVersion:number|null;
  state:'ACTIVE'|'INACTIVE'|'ARCHIVED';
  instruments:readonly string[];
  category:string|null;
  methodologies:readonly string[];
  timeframeRoles:Readonly<{macro:string|null;trend:string|null;confirmation:string|null;entry:string|null;trigger:string|null}>;
  createdAt:string|null;
  updatedAt:string|null;
  rules:Readonly<{total:number;required:number;optional:number;automatic:number;manual:number;external:number}>;
  usage:Readonly<{users:number;analyses:number;decisions:number;tradesTaken:number;lastUsedAt:string|null;activityState:'ACTIVE'|'ABANDONED'|'NOT_YET_USED'}>;
  health:Readonly<{state:'HEALTHY'|'NEEDS_CONFIGURATION'|'ARCHIVED';dataUnavailableRate:number|null;capabilityCoverage:Readonly<{automatic:number;manual:number;external:number}>}>;
}>;

export type HQStrategySource=Readonly<{
  id:string;user_id:string;name:string;is_default:boolean;is_archived:boolean;
  instruments?:readonly string[]|null;trading_style?:string|null;strategy_methodologies?:unknown;engine_version?:number|null;
  macro_timeframe?:string|null;trend_timeframe?:string|null;confirmation_timeframe?:string|null;entry_timeframe?:string|null;trigger_timeframe?:string|null;
  created_at?:string|null;updated_at?:string|null;
}>;
export type HQStrategyRuleSource=Readonly<{strategy_id:string;enabled:boolean;mandatory:boolean;evaluation_mode?:string|null}>;
export type HQStrategyMetrics=Readonly<{analyses?:number;decisions?:number;tradesTaken?:number;lastUsedAt?:string|null;users?:number;dataUnavailable?:number;dataObservations?:number}>;

const unique=(values:readonly string[])=>Object.freeze([...new Set(values.filter(Boolean))].sort());
const category=(value:string|null|undefined)=>value?.trim()||null;
const methodologyIds=(value:unknown)=>Array.isArray(value)?unique(value.filter((item):item is string=>typeof item==='string').map(item=>item.trim()).filter(Boolean)):Object.freeze([]);
const activity=(metrics:HQStrategyMetrics):HQStrategySummary['usage']['activityState']=>metrics.lastUsedAt?'ACTIVE':(metrics.analyses||metrics.decisions||metrics.tradesTaken)?'ACTIVE':'NOT_YET_USED';

export function toHQStrategySummary(source:HQStrategySource,ownerName:string|null,rules:readonly HQStrategyRuleSource[]=[],metrics:HQStrategyMetrics={}):HQStrategySummary{
  const enabled=rules.filter(rule=>rule.enabled);
  const automatic=enabled.filter(rule=>String(rule.evaluation_mode??'AUTOMATIC').toUpperCase()==='AUTOMATIC').length;
  const manual=enabled.filter(rule=>String(rule.evaluation_mode??'AUTOMATIC').toUpperCase()==='MANUAL').length;
  const external=Math.max(0,enabled.length-automatic-manual);
  const missingCore=!source.name.trim()||!(source.instruments??[]).length||enabled.length===0;
  const state=source.is_archived?'ARCHIVED':source.is_default?'ACTIVE':'INACTIVE';
  const unavailableRate=(metrics.dataObservations??0)>0?Number(metrics.dataUnavailable??0)/Number(metrics.dataObservations):null;
  return Object.freeze({
    id:source.id,customer:Object.freeze({id:source.user_id,name:ownerName}),name:source.name,revision:null,engineVersion:source.engine_version??null,state,
    instruments:unique(source.instruments??[]),category:category(source.trading_style),methodologies:methodologyIds(source.strategy_methodologies),
    timeframeRoles:Object.freeze({macro:source.macro_timeframe??null,trend:source.trend_timeframe??null,confirmation:source.confirmation_timeframe??null,entry:source.entry_timeframe??null,trigger:source.trigger_timeframe??null}),
    createdAt:source.created_at??null,updatedAt:source.updated_at??null,
    rules:Object.freeze({total:enabled.length,required:enabled.filter(rule=>rule.mandatory).length,optional:enabled.filter(rule=>!rule.mandatory).length,automatic,manual,external}),
    usage:Object.freeze({users:metrics.users??0,analyses:metrics.analyses??0,decisions:metrics.decisions??0,tradesTaken:metrics.tradesTaken??0,lastUsedAt:metrics.lastUsedAt??null,activityState:activity(metrics)}),
    health:Object.freeze({state:state==='ARCHIVED'?'ARCHIVED':missingCore?'NEEDS_CONFIGURATION':'HEALTHY',dataUnavailableRate:unavailableRate,capabilityCoverage:Object.freeze({automatic,manual,external})}),
  });
}

/** Fields that must never cross the HQ strategy-summary boundary. */
export const HQ_STRATEGY_EXCLUDED_FIELDS=Object.freeze(['description','personal_rules','strategy_methodologies','ai_behavior','evidence_weights','required_evidence','stop_limits','stop_limit_settings','exit_config','trailing_config','monitor_config','configuration','rule_key','label','minimum_confidence','weight','notes','copilot','logicTree','ruleTree']);
