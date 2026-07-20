import type { ManualConfirmation, ManualConfirmationState, StrategyRule, Verdict } from '../types/trade.ts';

export const RULE_LABELS:Record<string,string>={
  h4TrendAligned:'Higher Timeframe Trend',h1TrendAligned:'Trend Confirmation',structurePattern:'Market Structure',liquiditySweep:'Liquidity Sweep',chochConfirmed:'Change of Character',bosConfirmed:'Break of Structure',orderBlock:'Order Block',fairValueGap:'Fair Value Gap',retestConfirmed:'Retest or Rejection',sessionRequirement:'Trading Session',newsFilter:'News Filter',correlationFilter:'Market Correlation',psychology:'Psychology Check',psychologyCheck:'Psychology Check',
};

type Answer={label:string;state:ManualConfirmationState};
type Prompt={question:string;answers:Answer[]};

const prompts:Record<string,Prompt>={
  orderBlock:{question:'Did price react from the Order Block defined in your playbook?',answers:[{label:'Confirmed',state:'CONFIRMED'},{label:'Failed',state:'FAILED'},{label:'Unsure',state:'PENDING'}]},
  sessionRequirement:{question:'Is this setup occurring during one of your permitted trading sessions?',answers:[{label:'Yes',state:'CONFIRMED'},{label:'No',state:'FAILED'},{label:'Unsure',state:'PENDING'}]},
  newsFilter:{question:'Is the setup clear of restricted high-impact news?',answers:[{label:'Clear',state:'CONFIRMED'},{label:'Restricted news nearby',state:'FAILED'},{label:'Unsure',state:'PENDING'}]},
  correlationFilter:{question:'Does the required correlated-market context support this setup?',answers:[{label:'Supports',state:'CONFIRMED'},{label:'Conflicts',state:'FAILED'},{label:'Unsure',state:'PENDING'}]},
  psychology:{question:'Are you in a suitable mental state to take this trade?',answers:[{label:'Calm and focused',state:'CONFIRMED'},{label:'Not ready',state:'FAILED'},{label:'Unsure',state:'PENDING'}]},
  psychologyCheck:{question:'Are you in a suitable mental state to take this trade?',answers:[{label:'Calm and focused',state:'CONFIRMED'},{label:'Not ready',state:'FAILED'},{label:'Unsure',state:'PENDING'}]},
};

function titleCase(value:string){return value.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replaceAll('_',' ').replaceAll('-',' ').replace(/\b\w/g,letter=>letter.toUpperCase())}
export function ruleLabel(ruleKey:string,configuredLabel?:string){const configured=configuredLabel?.trim();return configured&&configured!==ruleKey?configured:(RULE_LABELS[ruleKey]??titleCase(ruleKey))}
export function manualRulePrompt(rule:StrategyRule):Prompt{return prompts[rule.ruleKey]??{question:`Does this setup satisfy your ${ruleLabel(rule.ruleKey,rule.label)} rule?`,answers:[{label:'Confirmed',state:'CONFIRMED'},{label:'Failed',state:'FAILED'},{label:'Unsure',state:'PENDING'}]}}
export function confirmationState(value:Partial<ManualConfirmation>|undefined):ManualConfirmationState{return value?.state??(value?.confirmed===true?'CONFIRMED':value?.confirmed===false?'FAILED':'PENDING')}
export function initialManualConfirmations(rules:StrategyRule[]):Record<string,ManualConfirmationState>{return Object.fromEntries(rules.filter(rule=>rule.enabled&&rule.evaluationMode==='MANUAL').map(rule=>[rule.ruleKey,'PENDING']))}
export function confirmationList(states:Record<string,ManualConfirmationState>):ManualConfirmation[]{return Object.entries(states).map(([evidenceKey,state])=>({evidenceKey,state}))}
export function applyManualRuleSemantics(baseVerdict:Verdict,rules:StrategyRule[],confirmations:ManualConfirmation[]):{verdict:Verdict;failed:string[];pending:string[]}{
  const byKey=new Map(confirmations.map(item=>[item.evidenceKey,confirmationState(item)]));
  const required=rules.filter(rule=>rule.enabled&&rule.mandatory&&rule.evaluationMode==='MANUAL');
  const failed=required.filter(rule=>(byKey.get(rule.ruleKey)??'PENDING')==='FAILED').map(rule=>ruleLabel(rule.ruleKey,rule.label));
  const pending=required.filter(rule=>(byKey.get(rule.ruleKey)??'PENDING')==='PENDING').map(rule=>ruleLabel(rule.ruleKey,rule.label));
  return {verdict:failed.length?'REJECTED':pending.length&&baseVerdict==='AUTHORIZED'?'WAIT':baseVerdict,failed,pending};
}

export type RequiredRuleEvaluation={ruleKey:string;label:string;mode:'AUTOMATIC'|'MANUAL'|'EXTERNAL';state:'PASSED'|'FAILED'|'NOT_EVALUATED'};
export function evaluateRequiredRules(rules:StrategyRule[],confirmations:ManualConfirmation[],automaticValues:Record<string,unknown>):RequiredRuleEvaluation[]{
  const byKey=new Map(confirmations.map(item=>[item.evidenceKey,confirmationState(item)]));
  return rules.filter(rule=>rule.enabled&&rule.mandatory).map(rule=>{
    const mode=rule.evaluationMode??'AUTOMATIC',label=ruleLabel(rule.ruleKey,rule.label);
    if(mode==='MANUAL'){
      const state=byKey.get(rule.ruleKey)??'PENDING';
      return {ruleKey:rule.ruleKey,label,mode,state:state==='CONFIRMED'?'PASSED':state==='FAILED'?'FAILED':'NOT_EVALUATED'};
    }
    if(mode==='EXTERNAL')return {ruleKey:rule.ruleKey,label,mode,state:'NOT_EVALUATED'};
    const value=automaticValues[rule.ruleKey];
    return {ruleKey:rule.ruleKey,label,mode,state:value===true?'PASSED':value===false?'FAILED':'NOT_EVALUATED'};
  });
}
