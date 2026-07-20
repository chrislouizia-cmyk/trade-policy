import type { ChartAnalysis, EvidenceKey, StrategyRule } from '../types/trade.ts';

export type MethodologyAuditStatus='PASSED'|'FAILED'|'NOT_EVALUATED';
export type MethodologyAuditRule=StrategyRule&{status:MethodologyAuditStatus;detail:string};
export type MethodologyAuditGroups={automatic:MethodologyAuditRule[];manual:MethodologyAuditRule[];external:MethodologyAuditRule[]};

export function buildMethodologyAudit(rules:StrategyRule[],input:Record<string,unknown>,analysis:ChartAnalysis|null):MethodologyAuditGroups{
  const groups:MethodologyAuditGroups={automatic:[],manual:[],external:[]};
  const confirmations=new Map(((input.manualConfirmations as Array<{evidenceKey:string;confirmed:boolean}>|undefined)??[]).map(item=>[item.evidenceKey,item.confirmed]));
  for(const rule of rules.filter(item=>item.enabled)){
    const mode=rule.evaluationMode??'AUTOMATIC';
    if(mode==='EXTERNAL'){groups.external.push({...rule,status:'NOT_EVALUATED',detail:'Pending integration'});continue}
    if(mode==='MANUAL'){
      const confirmed=confirmations.get(rule.ruleKey);
      groups.manual.push({...rule,status:confirmed===true?'PASSED':confirmed===false?'FAILED':'NOT_EVALUATED',detail:confirmed===true?'Confirmed by user':'User confirmation not provided'});
      continue;
    }
    const assessment=analysis?.evidence?.[rule.ruleKey as EvidenceKey];
    const value=assessment?.value??(typeof input[rule.ruleKey]==='boolean'?Boolean(input[rule.ruleKey]):undefined);
    groups.automatic.push({...rule,status:value===true?'PASSED':value===false?'FAILED':'NOT_EVALUATED',detail:value===undefined?'Not evaluated':'Evaluated automatically'});
  }
  return groups;
}
