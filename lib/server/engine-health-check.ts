import 'server-only';
import {validateTradeWithStrategy} from '@/lib/server/decision-engine';
import type {EvidenceKey,StrategyProfile,TradeInput,TradeResult} from '@/types/trade';

const evidence:Record<EvidenceKey,number>={h4TrendAligned:10,h1TrendAligned:10,structurePattern:10,liquiditySweep:10,chochConfirmed:10,bosConfirmed:10,orderBlock:7,fairValueGap:7,retestConfirmed:6};
const strategy:StrategyProfile={id:'internal-engine-health-check',name:'Internal engine health check',instruments:['XAUUSD'],trendTimeframe:'H4',confirmationTimeframe:'H1',entryTimeframe:'M15',minimumRR:1,maximumRiskPercent:1,maximumTradesPerDay:2,allowedSessions:['INTERNAL'],avoidHighImpactNews:false,requireTrendAlignment:true,requiredEvidence:Object.keys(evidence) as EvidenceKey[],evidenceWeights:evidence,stopLimits:{XAUUSD:3},stopLimitSettings:[{instrument:'XAUUSD',method:'POINTS',minimumValue:0,preferredValue:100,maximumValue:300}],authorizationScore:80,waitScore:60,lossStreakLimit:3,preferredSetups:['Internal Self Check'],rejectUnlistedSetups:false,aiBehavior:{tone:'analytical',strictness:'conservative',confidenceThreshold:80,explainDecisions:true,suggestAlternatives:false,useDisplayName:false}};
const input:TradeInput={instrument:'XAUUSD',direction:'BUY',entry:100,stopLoss:99,takeProfit:102,accountBalance:1000,riskPercent:.5,tradesToday:0,session:'INTERNAL',highImpactNews:false,h4TrendAligned:true,h1TrendAligned:true,structurePattern:true,liquiditySweep:true,chochConfirmed:true,bosConfirmed:true,orderBlock:true,fairValueGap:true,retestConfirmed:true,setupType:'Internal Self Check',setupConfidence:100};

export function runDeterministicEngineHealthCheck():TradeResult{
  const result=validateTradeWithStrategy(input,strategy);
  if(!result||!['AUTHORIZED','WAIT','REJECTED'].includes(result.verdict)||!Number.isFinite(result.score)||!Array.isArray(result.vetoes)||!Array.isArray(result.observations))throw new Error('Deterministic engine returned an invalid result.');
  return result;
}
