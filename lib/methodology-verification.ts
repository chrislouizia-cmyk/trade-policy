import { buildDecisionNarrative } from './intelligence/decision-narrative.ts';
import { validateTrade } from './trade-police.ts';
import type { DecisionNarrative } from '../types/intelligence.ts';
import type { EvidenceKey, StrategyProfile, StrategyRule, TradeInput } from '../types/trade.ts';

export type VerificationScenario={label:string;value:string}[];
export type MethodologyVerification={scenario:VerificationScenario;narrative:DecisionNarrative;input:TradeInput;displayVerdict:'APPROVE'|'WAIT'|'BLOCK'};

const names:Record<string,string>={XAUUSD:'Gold',XAGUSD:'Silver'};
const evidenceKeys:EvidenceKey[]=['h4TrendAligned','h1TrendAligned','structurePattern','liquiditySweep','chochConfirmed','bosConfirmed','orderBlock','fairValueGap','retestConfirmed'];

export function buildMethodologyVerification(profile:StrategyProfile,rules:StrategyRule[],now=new Date('2026-01-01T12:00:00.000Z')):MethodologyVerification{
  const instrument=profile.instruments[0]??'XAUUSD';
  const session=profile.allowedSessions[0]??'LONDON';
  const stopLimit=Number(profile.stopLimits?.[instrument]);
  const stopDistance=Number.isFinite(stopLimit)&&stopLimit>0?Math.min(stopLimit*.5,1):1;
  const rr=Math.max(Number(profile.minimumRR)||1,1)+.2;
  const entry=100;
  const evidence=Object.fromEntries(evidenceKeys.map(key=>[key,true])) as Record<EvidenceKey,boolean>;
  const manualConfirmations=rules.filter(rule=>rule.enabled&&rule.evaluationMode==='MANUAL'&&evidenceKeys.includes(rule.ruleKey as EvidenceKey)).map(rule=>({evidenceKey:rule.ruleKey as EvidenceKey,confirmed:true}));
  const input:TradeInput={...evidence,instrument,direction:'BUY',entry,stopLoss:entry-stopDistance,takeProfit:entry+stopDistance*rr,accountBalance:10000,riskPercent:Math.min(Number(profile.maximumRiskPercent)||.5,.5),tradesToday:0,session,highImpactNews:false,setupType:profile.preferredSetups?.[0]??'Playbook verification',setupConfidence:100,manualConfirmations,strategyProfile:{...profile,rules}};
  const result=validateTrade(input);
  const narrative=buildDecisionNarrative({result,strategy:{...profile,rules},input,now});
  const ruleRows=rules.filter(rule=>rule.enabled).slice(0,6).map(rule=>({label:rule.label,value:rule.evaluationMode==='EXTERNAL'?'External evidence supplied':rule.evaluationMode==='MANUAL'?'Confirmed by trader':'Detected'}));
  const scenario:VerificationScenario=[{label:'Market',value:names[instrument]??instrument},{label:'Session',value:session.replaceAll('_',' ')},{label:'Higher Timeframe Trend',value:`Bullish · ${profile.trendTimeframe}`},...ruleRows,{label:'Risk Reward',value:rr.toFixed(1)},{label:'News',value:'None'}];
  return {scenario,narrative,input,displayVerdict:narrative.recommendation==='ENTER'?'APPROVE':narrative.recommendation};
}
