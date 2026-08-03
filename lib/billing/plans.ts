export type PlanCode='FREE'|'PRO'|'TEAM';
export type PlanDefinition={code:PlanCode;name:string;monthlyAnalysisLimit:number|null;maximumActiveStrategies:number;canViewCompleteDecisionReport:boolean;canUseExpandedHistory:boolean;canUseExpandedAnalytics:boolean;checkoutEnabled:boolean};
export const PLANS:Record<PlanCode,PlanDefinition>={
  FREE:{code:'FREE',name:'Free',monthlyAnalysisLimit:30,maximumActiveStrategies:1,canViewCompleteDecisionReport:false,canUseExpandedHistory:false,canUseExpandedAnalytics:false,checkoutEnabled:false},
  PRO:{code:'PRO',name:'Pro',monthlyAnalysisLimit:null,maximumActiveStrategies:10,canViewCompleteDecisionReport:true,canUseExpandedHistory:true,canUseExpandedAnalytics:true,checkoutEnabled:true},
  TEAM:{code:'TEAM',name:'Team',monthlyAnalysisLimit:null,maximumActiveStrategies:50,canViewCompleteDecisionReport:true,canUseExpandedHistory:true,canUseExpandedAnalytics:true,checkoutEnabled:false},
};
export function planFor(value:unknown):PlanDefinition{return PLANS[String(value??'FREE').toUpperCase() as PlanCode]??PLANS.FREE}
