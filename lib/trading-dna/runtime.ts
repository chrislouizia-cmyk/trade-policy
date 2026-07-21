import type { ManualConfirmation, StrategyProfile, TradeInput, TradeResult, Verdict } from '../../types/trade.ts';
import { confirmationState } from '../manual-confirmations.ts';
import { composerTreeFromStrategyRules, summarizeComposerCondition, type ComposerCondition, type ComposerGroup } from './composer.ts';
import { TRADING_DNA_RULES } from './registry.ts';
import type { TradingDnaEvaluationType, TradingDnaOperator } from './types.ts';

export type RuntimeStatus='PASS'|'FAIL'|'PENDING';
export type RuntimeFact={value:unknown;reason:string;source?:'AUTOMATIC'|'MANUAL'|'EXTERNAL'};
export type TradingDnaRuntimeContext={facts:Record<string,RuntimeFact|unknown>;manualConfirmations?:ManualConfirmation[]};
export type ConditionEvidence={id:string;ruleId:string;label:string;status:RuntimeStatus;required:boolean;weight?:number;evaluationType:TradingDnaEvaluationType;operator:TradingDnaOperator;actual:unknown;expected:unknown[];reason:string;groupPath:string[]};
export type GroupEvidence={id:string;logic:'ALL'|'ANY';status:RuntimeStatus;reason:string;children:string[]};
export type TradingDnaEvidenceReport={status:RuntimeStatus;summary:string;conditions:ConditionEvidence[];groups:GroupEvidence[];counts:{passed:number;failed:number;pending:number};generatedAt:string};

const registry=new Map(TRADING_DNA_RULES.map(rule=>[rule.id,rule]));
const unwrap=(fact:RuntimeFact|unknown):{value:unknown;reason?:string}=>fact&&typeof fact==='object'&&'value' in fact?fact as RuntimeFact:{value:fact};
const compare=(a:unknown,b:unknown)=>typeof a==='number'&&typeof b==='number'?a-b:String(a).localeCompare(String(b));

export function evaluateTradingDnaOperator(operator:TradingDnaOperator,actual:unknown,expected:unknown[]):boolean{
  switch(operator){
    case 'GREATER_THAN':return compare(actual,expected[0])>0;
    case 'LESS_THAN':return compare(actual,expected[0])<0;
    case 'GREATER_THAN_OR_EQUAL':return compare(actual,expected[0])>=0;
    case 'LESS_THAN_OR_EQUAL':return compare(actual,expected[0])<=0;
    case 'EQUALS':return actual===expected[0]; case 'NOT_EQUALS':return actual!==expected[0];
    case 'IS_TRUE':case 'CONFIRMED':return actual===true||actual==='CONFIRMED';
    case 'IS_FALSE':case 'FAILED':return actual===false||actual==='FAILED';
    case 'EXISTS':return actual!==undefined&&actual!==null&&actual!==false;
    case 'MISSING':return actual===undefined||actual===null||actual===false;
    case 'CROSSES_ABOVE':return Array.isArray(actual)&&actual.length>=2?compare(actual.at(-2),expected[0])<=0&&compare(actual.at(-1),expected[0])>0:false;
    case 'CROSSES_BELOW':return Array.isArray(actual)&&actual.length>=2?compare(actual.at(-2),expected[0])>=0&&compare(actual.at(-1),expected[0])<0:false;
    case 'BETWEEN':case 'WITHIN':return compare(actual,expected[0])>=0&&compare(actual,expected[1])<=0;
    case 'OUTSIDE':return compare(actual,expected[0])<0||compare(actual,expected[1])>0;
    case 'CONTAINS':return Array.isArray(actual)?actual.includes(expected[0]):String(actual).includes(String(expected[0]));
    case 'EXCLUDES':return Array.isArray(actual)?!actual.includes(expected[0]):!String(actual).includes(String(expected[0]));
  }
}

function conditionFact(condition:ComposerCondition,context:TradingDnaRuntimeContext){
  const manualKey=condition.legacyRule?.ruleKey;
  const manual=manualKey?context.manualConfirmations?.find(item=>item.evidenceKey===manualKey):undefined;
  if(manual)return {value:confirmationState(manual),reason:`User confirmation is ${confirmationState(manual).toLowerCase()}.`};
  return unwrap(context.facts[condition.id]??context.facts[condition.ruleId]);
}

export function evaluateTradingDnaRuntime(rules:StrategyProfile['rules'],context:TradingDnaRuntimeContext,now=()=>new Date().toISOString()):TradingDnaEvidenceReport{
  const root=composerTreeFromStrategyRules((rules??[]).filter(rule=>rule.enabled));const conditions:ConditionEvidence[]=[];const groups:GroupEvidence[]=[];
  function evaluateCondition(condition:ComposerCondition,path:string[]):RuntimeStatus{
    const definition=registry.get(condition.ruleId);const fact=conditionFact(condition,context);const evaluationType=definition?.evaluationType??condition.legacyRule?.evaluationMode??'MANUAL';let status:RuntimeStatus,reason:string;
    if(fact.value===undefined||fact.value===null||fact.value==='PENDING'){status='PENDING';reason=fact.reason??`${definition?.displayName??condition.ruleId} has not supplied evidence yet.`}
    else {const passed=evaluateTradingDnaOperator(condition.operator,fact.value,condition.operands);status=passed?'PASS':'FAIL';reason=fact.reason??`${String(fact.value)} ${passed?'satisfies':'does not satisfy'} ${condition.operator}${condition.operands.length?` ${condition.operands.join(' and ')}`:''}.`}
    conditions.push({id:condition.id,ruleId:condition.ruleId,label:summarizeComposerCondition(condition),status,required:condition.legacyRule?.mandatory??true,weight:condition.legacyRule?.weight??0,evaluationType,operator:condition.operator,actual:fact.value,expected:condition.operands,reason,groupPath:path});return status;
  }
  function evaluateGroup(group:ComposerGroup,path:string[]):RuntimeStatus{const statuses=group.children.map(child=>child.kind==='GROUP'?evaluateGroup(child,[...path,group.id]):{status:evaluateCondition(child,[...path,group.id]),required:child.legacyRule?.mandatory??true}).filter(item=>typeof item==='string'||item.required).map(item=>typeof item==='string'?item:item.status);const status:RuntimeStatus=!group.children.length?'PENDING':!statuses.length?'PASS':group.logic==='ALL'?(statuses.includes('FAIL')?'FAIL':statuses.includes('PENDING')?'PENDING':'PASS'):(statuses.includes('PASS')?'PASS':statuses.includes('PENDING')?'PENDING':'FAIL');const reason=!group.children.length?'The group contains no conditions.':group.logic==='ALL'?status==='PASS'?'Every required condition passed.':status==='FAIL'?'At least one required condition failed.':'No condition failed, but required evidence is still pending.':status==='PASS'?'At least one required alternative passed.':status==='FAIL'?'Every required alternative failed.':'No required alternative passed and evidence is still pending.';groups.push({id:group.id,logic:group.logic,status,reason,children:group.children.map(child=>child.id)});return status}
  const status=evaluateGroup(root,[]);const counts={passed:conditions.filter(item=>item.status==='PASS').length,failed:conditions.filter(item=>item.status==='FAIL').length,pending:conditions.filter(item=>item.status==='PENDING').length};return {status,summary:status==='PASS'?'Every required Trading DNA group is satisfied.':status==='FAIL'?'One or more Trading DNA conditions failed.':'Trading DNA evidence is still pending.',conditions,groups,counts,generatedAt:now()};
}

export function buildTradingDnaRuntimeContext(input:TradeInput,profile:StrategyProfile):TradingDnaRuntimeContext{
  const riskDistance=Math.abs(input.entry-input.stopLoss),rewardDistance=Math.abs(input.takeProfit-input.entry),rr=riskDistance?rewardDistance/riskDistance:0;const session=input.session.toLowerCase().replaceAll('_',' ');
  const facts:Record<string,RuntimeFact|unknown>={
    'structure.trend-alignment':{value:input.h4TrendAligned&&input.h1TrendAligned,reason:'Higher and confirmation timeframe alignment was evaluated.'},
    'structure.bos':{value:input.bosConfirmed,reason:input.bosConfirmed?'A break of structure was detected.':'No break of structure was detected.'},
    'structure.choch':{value:input.chochConfirmed,reason:input.chochConfirmed?'Change of Character was confirmed.':'Change of Character was not confirmed.'},
    'smart-money.liquidity-sweep':{value:input.liquiditySweep,reason:input.liquiditySweep?'A liquidity sweep was detected.':'No liquidity sweep was detected.'},
    'smart-money.order-block':{value:input.orderBlock,reason:input.orderBlock?'The configured Order Block was confirmed.':'The configured Order Block was not confirmed.'},
    'smart-money.fair-value-gap':{value:input.fairValueGap,reason:input.fairValueGap?'A Fair Value Gap was confirmed.':'No Fair Value Gap was confirmed.'},
    'price-action.retest':{value:input.retestConfirmed,reason:input.retestConfirmed?'A retest was confirmed.':'The retest remains unconfirmed.'},
    'risk.minimum-rr':{value:rr,reason:`Calculated Risk/Reward is ${Number(rr.toFixed(2))}:1.`},
    'risk.maximum-risk':{value:input.riskPercent,reason:`Configured trade risk is ${input.riskPercent}%.`},
    'session.london':{value:session==='london',reason:`The selected session is ${input.session}.`},
    'session.new-york':{value:session==='new york',reason:`The selected session is ${input.session}.`},
    'session.asia':{value:session==='asia',reason:`The selected session is ${input.session}.`},
    'external.high-impact-news':{value:!input.highImpactNews,reason:input.highImpactNews?'High-impact news conflicts with this trade.':'No high-impact news conflict was declared.'},
  };
  for(const rule of profile.rules??[]){if(rule.ruleKey.startsWith('dna.v1.'))continue;const legacy:Record<string,string>={h4TrendAligned:'structure.trend-alignment',h1TrendAligned:'structure.trend-alignment',bosConfirmed:'structure.bos',chochConfirmed:'structure.choch',liquiditySweep:'smart-money.liquidity-sweep',orderBlock:'smart-money.order-block',fairValueGap:'smart-money.fair-value-gap',retestConfirmed:'price-action.retest'};const id=legacy[rule.ruleKey];if(id&&facts[id]===undefined)facts[id]=(input as unknown as Record<string,unknown>)[rule.ruleKey]}
  return {facts,manualConfirmations:input.manualConfirmations};
}

export function applyTradingDnaRuntime(result:TradeResult,report:TradingDnaEvidenceReport):TradeResult{
  const verdict:Verdict=report.status==='FAIL'?'REJECTED':report.status==='PENDING'&&result.verdict==='AUTHORIZED'?'WAIT':result.verdict;const failures=report.conditions.filter(item=>item.required&&item.status==='FAIL').map(item=>`${item.label}: ${item.reason}`);const pending=report.conditions.filter(item=>item.required&&item.status==='PENDING').map(item=>`${item.label}: ${item.reason}`);return {...result,verdict,vetoes:[...new Set([...result.vetoes,...failures])],observations:[...new Set([...result.observations,...pending])]};
}
