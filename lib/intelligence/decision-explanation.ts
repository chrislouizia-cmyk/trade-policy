import type {TradingDnaEvidenceReport,ConditionEvidence} from '../trading-dna/runtime.ts';
import type {ChartAnalysis,StrategyProfile,TradeResult} from '../../types/trade.ts';
import type {DecisionExplanationItem,DecisionExplanationSummary,DecisionExplanationVerdict,DecisionNarrative,NextAction} from '../../types/intelligence.ts';
import type {TradeAuthorizationEligibility} from '../trade-authorization.ts';

const UNKNOWN_TRIGGER='Trade Police cannot determine the next trigger from the available rule definition.';
const INTEGRITY='This verdict was determined by your saved trading rules and verified market evidence. AI may explain the result but cannot change it.';

const copy:Record<DecisionExplanationVerdict,{headline:string;explanation:string;nextAction:string}>={
  READY:{headline:'Your required trading rules are confirmed.',explanation:'The current setup satisfies every required rule that Trade Police can verify.',nextAction:'Complete your final risk check before deciding whether to act.'},
  WAIT:{headline:'Do not risk your money yet.',explanation:'One or more required confirmations are still missing.',nextAction:UNKNOWN_TRIGGER},
  BLOCKED:{headline:'This setup conflicts with your trading rules.',explanation:'At least one required rule is violated or a forbidden condition is present.',nextAction:UNKNOWN_TRIGGER},
  NO_SETUP:{headline:'Your setup is not present right now.',explanation:'The current market does not match the setup saved in your trading rules.',nextAction:'Wait for the required pattern to form or check another instrument.'},
  MARKET_CLOSED:{headline:'The market is closed.',explanation:'There are no fresh completed candles available for a current evaluation.',nextAction:'Return when the market reopens.'},
  DATA_UNAVAILABLE:{headline:'Current market data could not be verified.',explanation:'No trustworthy decision was produced.',nextAction:'Try again shortly. Do not use this result to make a trading decision.'},
  STRATEGY_INCOMPLETE:{headline:'Your trading rules cannot be fully evaluated.',explanation:'One or more required rules are incomplete or unsupported.',nextAction:'Review the highlighted rules before checking another setup.'},
};

function value(value:unknown):string|undefined{
  if(value===undefined||value===null)return undefined;
  if(Array.isArray(value))return value.map(item=>String(item)).join(' · ');
  if(typeof value==='object')return undefined;
  return String(value);
}

function verdictFor(analysis:ChartAnalysis,result:TradeResult|null,authorizationEligibility?:TradeAuthorizationEligibility):DecisionExplanationVerdict{
  const marketClosed=analysis.warnings.some(warning=>/market\s+closed|outside\s+market\s+hours/i.test(warning));
  if(marketClosed)return 'MARKET_CLOSED';
  if(['DATA_UNAVAILABLE','INSUFFICIENT_DATA','ANALYSIS_FAILED'].includes(analysis.status))return 'DATA_UNAVAILABLE';
  if(['STRATEGY_UNSUPPORTED','STRATEGY_INCOMPLETE'].includes(analysis.status))return 'STRATEGY_INCOMPLETE';
  if(analysis.status==='NO_RELEVANT_EVIDENCE')return 'NO_SETUP';
  if(authorizationEligibility){
    if(authorizationEligibility.state==='BLOCKED'||authorizationEligibility.state==='DATA_UNAVAILABLE')return authorizationEligibility.state==='BLOCKED'?'BLOCKED':'DATA_UNAVAILABLE';
    if(authorizationEligibility.state==='WAIT')return 'WAIT';
    if(authorizationEligibility.state==='READY')return 'READY';
  }
  if(result?.verdict==='AUTHORIZED')return 'READY';
  if(result?.verdict==='REJECTED')return 'BLOCKED';
  if(result?.verdict==='WAIT')return 'WAIT';
  return analysis.candidates.some(candidate=>candidate.status==='READY')?'READY':'WAIT';
}

function actionFor(condition:ConditionEvidence,narrative?:DecisionNarrative):NextAction|undefined{
  return narrative?.nextActions
    .filter(action=>action.relatedEvidenceIds.includes(condition.id)||action.relatedEvidenceIds.includes(condition.ruleId))
    .sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id))[0];
}

function itemFor(condition:ConditionEvidence,analysis:ChartAnalysis,narrative?:DecisionNarrative):DecisionExplanationItem{
  const supported=condition.evaluationType!=='EXTERNAL';
  const state=condition.status==='PASS'
    ?'CONFIRMED'
    :condition.status==='FAIL'?'BLOCKED'
      :supported?'MISSING':'NOT_AVAILABLE';
  const action=actionFor(condition,narrative);
  return {
    id:condition.id,
    ruleId:condition.ruleId,
    title:condition.label,
    plainLanguageDescription:condition.reason,
    state,
    required:condition.required,
    supported,
    observedValue:value(condition.actual),
    expectedValue:value(condition.expected),
    detectedAt:analysis.calculatedAt,
    source:condition.evaluationType==='MANUAL'?'Manual confirmation':condition.evaluationType==='EXTERNAL'?'Could not be verified':`Completed ${analysis.timeframe} candles · ${analysis.provider}`,
    nextAction:state==='MISSING'||state==='BLOCKED'||state==='NOT_AVAILABLE'?(action?.label??UNKNOWN_TRIGGER):undefined,
    evidenceIds:[condition.id],
    deterministic:true,
  };
}

function fallbackItems(analysis:ChartAnalysis,strategy:StrategyProfile):DecisionExplanationItem[]{
  const required=new Set(strategy.requiredEvidence);
  for(const rule of strategy.rules??[])if(rule.enabled&&rule.mandatory)required.add(rule.ruleKey as keyof ChartAnalysis['evidence']);
  return Object.entries(analysis.evidence).map(([key,evidence],index)=>{
    const rule=(strategy.rules??[]).find(candidate=>candidate.ruleKey===key);
    const isRequired=required.has(key as keyof ChartAnalysis['evidence']);
    return {id:`market-evidence:${index}:${key}`,ruleId:key,title:rule?.label??key.replace(/([A-Z])/g,' $1').trim(),plainLanguageDescription:evidence.reason,state:evidence.value?(isRequired?'CONFIRMED':'NOT_REQUIRED'):'MISSING',required:isRequired,supported:true,observedValue:evidence.value?'Confirmed':'Not confirmed',detectedAt:analysis.calculatedAt,source:`Completed ${analysis.timeframe} candles · ${analysis.provider}`,nextAction:evidence.value?undefined:UNKNOWN_TRIGGER,evidenceIds:[key],deterministic:true};
  });
}

function stableItems(items:DecisionExplanationItem[]):DecisionExplanationItem[]{
  const rank={CONFIRMED:0,MISSING:1,BLOCKED:2,NOT_AVAILABLE:3,NOT_REQUIRED:4};
  return items.map((item,index)=>({item,index})).sort((a,b)=>Number(b.item.required)-Number(a.item.required)||rank[a.item.state]-rank[b.item.state]||a.index-b.index||a.item.id.localeCompare(b.item.id)).map(entry=>entry.item);
}

function missingConfirmationItems(analysis:ChartAnalysis,authorizationEligibility?:TradeAuthorizationEligibility):DecisionExplanationItem[]{
  if(!authorizationEligibility?.missingMandatoryConfirmations?.length)return [];
  return authorizationEligibility.missingMandatoryConfirmations.map((item,index)=>({
    id:`authorization-missing:${index}:${item.label}`,
    ruleId:`authorization-missing:${index}`,
    title:item.label,
    plainLanguageDescription:item.reason,
    state:'MISSING' as const,
    required:true,
    supported:true,
    observedValue:undefined,
    expectedValue:undefined,
    detectedAt:analysis.calculatedAt,
    source:'Authorization review',
    nextAction:undefined,
    evidenceIds:[`authorization-missing:${index}`],
    deterministic:true,
  }));
}

function primaryReason(verdict:DecisionExplanationVerdict,items:DecisionExplanationItem[],authorizationEligibility?:TradeAuthorizationEligibility):string{
  if(verdict==='DATA_UNAVAILABLE')return 'Primary reason: Current market data could not be verified.';
  if(verdict==='MARKET_CLOSED')return 'Primary reason: No fresh completed candles are available while the market is closed.';
  if(verdict==='STRATEGY_INCOMPLETE'){
    const item=items.find(candidate=>candidate.required&&!candidate.supported)||items.find(candidate=>candidate.required&&candidate.state==='NOT_AVAILABLE');
    return `Primary reason: ${item?.plainLanguageDescription??'A required trading rule cannot be evaluated.'}`;
  }
  if(authorizationEligibility?.state==='WAIT' && authorizationEligibility.missingMandatoryConfirmations.length>0){
    const missing=authorizationEligibility.missingMandatoryConfirmations[0];
    return `Primary reason: ${missing.reason}`;
  }
  const blocking=items.find(item=>item.required&&item.state==='BLOCKED');
  if(blocking)return `Primary reason: ${blocking.plainLanguageDescription}`;
  const missing=items.find(item=>item.required&&item.state==='MISSING');
  if(missing)return `Primary reason: ${missing.plainLanguageDescription}`;
  const optional=items.find(item=>!item.required&&item.state==='MISSING');
  if(optional)return `Primary reason: ${optional.plainLanguageDescription}`;
  if(verdict==='NO_SETUP')return 'Primary reason: The saved setup is not present in the current market evidence.';
  return verdict==='READY'?'Every required rule that Trade Police can verify is confirmed.':'Primary reason: Required confirmation is incomplete.';
}

export function buildDecisionExplanation({analysis,result,narrative,evidenceReport,strategy,authorizationEligibility,now=new Date()}:{analysis:ChartAnalysis;result:TradeResult|null;narrative?:DecisionNarrative;evidenceReport?:TradingDnaEvidenceReport;strategy:StrategyProfile;authorizationEligibility?:TradeAuthorizationEligibility;now?:Date}):DecisionExplanationSummary{
  const verdict=verdictFor(analysis,result,authorizationEligibility);
  const baseItems=evidenceReport?.conditions.map(condition=>itemFor(condition,analysis,narrative))??fallbackItems(analysis,strategy);
  const items=stableItems([...baseItems,...missingConfirmationItems(analysis,authorizationEligibility)]);
  const required=items.filter(item=>item.required),optional=items.filter(item=>!item.required);
  const primary=primaryReason(verdict,items,authorizationEligibility);
  const primaryItem=items.find(item=>primary.includes(item.plainLanguageDescription));
  const nextAction=copy[verdict].nextAction===UNKNOWN_TRIGGER?(primaryItem?.nextAction??UNKNOWN_TRIGGER):copy[verdict].nextAction;
  const candleDate=new Date(analysis.latestCandleTimestamp),age=Number.isFinite(candleDate.getTime())?Math.max(0,Math.floor((now.getTime()-candleDate.getTime())/1000)):undefined;
  const freshness=verdict==='MARKET_CLOSED'?'MARKET_CLOSED':verdict==='DATA_UNAVAILABLE'?'UNAVAILABLE':age===undefined?'UNAVAILABLE':age<=300?'CURRENT':'DELAYED';
  return {verdict,...copy[verdict],confirmedRequiredCount:required.filter(item=>item.state==='CONFIRMED').length,totalRequiredCount:required.length,confirmedOptionalCount:optional.filter(item=>item.state==='CONFIRMED'||item.state==='NOT_REQUIRED').length,totalOptionalCount:optional.length,primaryReason:primary,nextAction,items,dataStatus:{provider:analysis.provider||'Unavailable',lastVerifiedCandleAt:analysis.latestCandleTimestamp||undefined,candleAgeSeconds:age,freshness,calculationCompletedAt:analysis.calculatedAt||undefined},integrityStatement:INTEGRITY};
}

export {INTEGRITY as DECISION_INTEGRITY_STATEMENT,UNKNOWN_TRIGGER as UNKNOWN_NEXT_TRIGGER};
