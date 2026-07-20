import type { ChartAnalysis, EvidenceKey, StrategyRule } from '../types/trade.ts';
import { confirmationState, ruleLabel } from './manual-confirmations.ts';

export type MethodologyAuditStatus='PASSED'|'FAILED'|'NOT_EVALUATED';
export type MethodologyAuditRule=StrategyRule&{status:MethodologyAuditStatus;detail:string};
export type MethodologyAuditGroups={required:MethodologyAuditRule[];optional:MethodologyAuditRule[];manual:MethodologyAuditRule[];external:MethodologyAuditRule[]};

export function buildMethodologyAudit(rules:StrategyRule[],input:Record<string,unknown>,analysis:ChartAnalysis|null):MethodologyAuditGroups{
  const groups:MethodologyAuditGroups={required:[],optional:[],manual:[],external:[]};
  const confirmations=new Map(((input.manualConfirmations as Array<{evidenceKey:string;state?:'PENDING'|'CONFIRMED'|'FAILED';confirmed?:boolean}>|undefined)??[]).map(item=>[item.evidenceKey,confirmationState(item)]));
  for(const rule of rules.filter(item=>item.enabled)){
    const mode=rule.evaluationMode??'AUTOMATIC';
    const label=ruleLabel(rule.ruleKey,rule.label);
    if(mode==='EXTERNAL'){groups.external.push({...rule,label,status:'NOT_EVALUATED',detail:'Pending integration'});continue}
    if(mode==='MANUAL'){
      const state=confirmations.get(rule.ruleKey)??'PENDING';
      groups.manual.push({...rule,label,status:state==='CONFIRMED'?'PASSED':state==='FAILED'?'FAILED':'NOT_EVALUATED',detail:state==='CONFIRMED'?'Confirmed by you':state==='FAILED'?'Failed by you':'Pending your confirmation'});
      continue;
    }
    const assessment=analysis?.evidence?.[rule.ruleKey as EvidenceKey];
    const value=assessment?.value??(typeof input[rule.ruleKey]==='boolean'?Boolean(input[rule.ruleKey]):undefined);
    groups[rule.mandatory?'required':'optional'].push({...rule,label,status:value===true?'PASSED':value===false?'FAILED':'NOT_EVALUATED',detail:value===undefined?'Not evaluated':'Evaluated automatically'});
  }
  return groups;
}
