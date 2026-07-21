import type { StrategyProfile } from '../../types/trade.ts';
import type { EvidenceAssessment } from '../market-analysis.ts';
import { evaluateTradingDnaRuntime, type RuntimeFact, type RuntimeStatus, type TradingDnaEvidenceReport, type TradingDnaRuntimeContext } from './runtime.ts';

export type LiveReadinessState='READY'|'NOT_READY'|'WAITING_FOR_CONFIRMATION'|'CONFIGURATION_REQUIRED';
export type LiveReadinessCounts={passed:number;failed:number;pending:number};
export type LiveReadinessItem={label:string;status:RuntimeStatus;required:boolean;weight:number;reason:string;evidenceSource:string};
export type LiveSetupReadiness={percentage:number|null;state:LiveReadinessState;required:LiveReadinessCounts;optional:LiveReadinessCounts;totalRequiredWeight:number;passingRequiredWeight:number;formula:string;conditions:LiveReadinessItem[];blockers:LiveReadinessItem[];pendingConfirmations:LiveReadinessItem[]};

const evidenceMap:Record<string,string[]>={
  h4TrendAligned:['structure.trend-alignment'],h1TrendAligned:['structure.trend-alignment'],structurePattern:['structure.higher-high','structure.higher-low','structure.lower-high','structure.lower-low'],
  liquiditySweep:['smart-money.liquidity-sweep'],chochConfirmed:['structure.choch'],bosConfirmed:['structure.bos'],fairValueGap:['smart-money.fair-value-gap'],
  retestConfirmed:['price-action.retest'],premiumDiscount:['smart-money.premium','smart-money.discount'],rejectionCandle:['price-action.strong-rejection'],volumeConfirmation:['volume.above-average','volume.spike'],
};
const sources:Record<string,string>={h4TrendAligned:'trend timeframe market data',h1TrendAligned:'multi-timeframe market data',structurePattern:'price-structure detector',liquiditySweep:'liquidity-sweep detector',chochConfirmed:'CHoCH detector',bosConfirmed:'BOS detector',orderBlock:'order-block detector',fairValueGap:'fair-value-gap detector',retestConfirmed:'retest detector',premiumDiscount:'premium/discount range detector',rejectionCandle:'rejection-candle detector',volumeConfirmation:'volume detector'};

export function buildLiveTradingDnaContext(evidence:Record<string,EvidenceAssessment>):TradingDnaRuntimeContext{
  const facts:Record<string,RuntimeFact>={};
  for(const [evidenceId,registryIds] of Object.entries(evidenceMap)){const assessment=evidence[evidenceId];if(!assessment)continue;for(const registryId of registryIds)facts[registryId]={value:assessment.value,reason:assessment.reason,source:'AUTOMATIC'}}
  return {facts};
}
const counts=():LiveReadinessCounts=>({passed:0,failed:0,pending:0});
function sourceFor(ruleId:string){for(const [key,ids] of Object.entries(evidenceMap))if(ids.includes(ruleId))return sources[key]??'live market detector';return 'evidence unavailable from live market analysis'}

export function calculateLiveSetupReadiness(report:TradingDnaEvidenceReport):LiveSetupReadiness{
  const required=counts(),optional=counts();let totalRequiredWeight=0,passingRequiredWeight=0;
  const conditions=report.conditions.map((condition):LiveReadinessItem=>{const weight=Math.max(0,Number(condition.weight)||0);(condition.required?required:optional)[condition.status==='PASS'?'passed':condition.status==='FAIL'?'failed':'pending']++;if(condition.required){totalRequiredWeight+=weight;if(condition.status==='PASS')passingRequiredWeight+=weight}return {label:condition.label,status:condition.status,required:condition.required,weight,reason:condition.reason,evidenceSource:condition.evaluationType==='MANUAL'?'trader confirmation':condition.evaluationType==='EXTERNAL'?'external integration':sourceFor(condition.ruleId)}});
  const validRequired=conditions.filter(item=>item.required&&item.weight>0);const percentage=validRequired.length&&totalRequiredWeight>0?Math.round(passingRequiredWeight/totalRequiredWeight*100):null;
  const state:LiveReadinessState=!validRequired.length||totalRequiredWeight<=0?'CONFIGURATION_REQUIRED':report.status==='FAIL'?'NOT_READY':report.status==='PENDING'?'WAITING_FOR_CONFIRMATION':'READY';
  return {percentage,state,required,optional,totalRequiredWeight,passingRequiredWeight,formula:'round(passing required weight / total required weight × 100)',conditions,blockers:conditions.filter(item=>item.required&&item.status==='FAIL').sort((a,b)=>b.weight-a.weight).slice(0,3),pendingConfirmations:conditions.filter(item=>item.required&&item.status==='PENDING').sort((a,b)=>b.weight-a.weight).slice(0,3)};
}
function readinessRules(strategy:StrategyProfile){
  if(strategy.rules?.length)return strategy.rules;
  const required=new Set(strategy.requiredEvidence??[]);
  return Object.entries(strategy.evidenceWeights??{}).map(([ruleKey,weight])=>({ruleKey,label:ruleKey,enabled:true,mandatory:required.has(ruleKey as never),weight:Number(weight),minimumConfidence:0,timeframeRole:'ENTRY' as const,evaluationMode:'AUTOMATIC' as const}));
}
export function evaluateLiveTradingDna(strategy:StrategyProfile,evidence:Record<string,EvidenceAssessment>,now?:()=>string){const report=evaluateTradingDnaRuntime(readinessRules(strategy),buildLiveTradingDnaContext(evidence),now);return {report,readiness:calculateLiveSetupReadiness(report)}}
