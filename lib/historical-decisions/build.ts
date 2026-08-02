import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ChartAnalysis, StrategyProfile, TradeInput, TradeResult } from '@/types/trade';
import type { DecisionExplanationSummary } from '@/types/intelligence';
import { HISTORICAL_DECISION_SCHEMA_VERSION, type HistoricalDecisionEvidenceItem, type HistoricalDecisionReportSnapshot } from '@/types/historical-decision';
import { deterministicFingerprint } from './fingerprint';
import { strategyRevisionId } from './strategy-revision';

const limitations=['This report reflects the information available when the decision was saved. It is not updated with later market data.','Trade Police supports disciplined decision-making. It does not predict profits, execute trades, provide financial advice, or guarantee outcomes.'];
const convert=(item:DecisionExplanationSummary['items'][number]):HistoricalDecisionEvidenceItem=>({id:item.id,...(item.ruleId?{ruleId:item.ruleId}:{}),title:item.title,description:item.plainLanguageDescription,state:item.state,required:item.required,supported:item.supported,...(item.observedValue?{observedValue:item.observedValue}:{}),...(item.expectedValue?{expectedValue:item.expectedValue}:{}),...(item.detectedAt?{detectedAt:item.detectedAt}:{}),...(item.source?{source:item.source}:{}),...(item.nextAction?{nextAction:item.nextAction}:{}),evidenceIds:[...item.evidenceIds],deterministic:true});

export function buildHistoricalDecisionSnapshot({userId,analysis,strategy,input,result,explanation,reportId=randomUUID()}:{userId:string;analysis:ChartAnalysis;strategy:StrategyProfile;input:TradeInput;result:TradeResult;explanation:DecisionExplanationSummary;reportId?:string}):HistoricalDecisionReportSnapshot{
  if(!strategy.id)throw new Error('A persisted strategy identity is required for a historical report.');
  const items=explanation.items.map(convert),createdAt=new Date(analysis.calculatedAt).toISOString();
  const base:HistoricalDecisionReportSnapshot={
    reportId,schemaVersion:HISTORICAL_DECISION_SCHEMA_VERSION,userId,verdict:explanation.verdict,
    ...(typeof analysis.liveAnalysisConfidence==='number'?{readinessPercent:analysis.liveAnalysisConfidence}:{}),
    confirmedRequiredCount:explanation.confirmedRequiredCount,totalRequiredCount:explanation.totalRequiredCount,
    confirmedOptionalCount:explanation.confirmedOptionalCount,totalOptionalCount:explanation.totalOptionalCount,
    headline:explanation.headline,explanation:explanation.explanation,primaryReason:explanation.primaryReason,nextAction:explanation.nextAction,
    instrument:analysis.instrument,timeframe:analysis.timeframe,strategyId:strategy.id,strategyName:strategy.name,
    strategyRevisionId:strategyRevisionId(strategy),strategyVersion:String(strategy.engineVersion??1),marketData:{...explanation.dataStatus},
    requiredRules:items.filter(item=>item.required&&!['BLOCKED','NOT_AVAILABLE'].includes(item.state)),
    helpfulConfirmations:items.filter(item=>!item.required&&!['BLOCKED','NOT_AVAILABLE','NOT_REQUIRED'].includes(item.state)),
    blockingConditions:items.filter(item=>item.state==='BLOCKED'),unavailableEvidence:items.filter(item=>item.state==='NOT_AVAILABLE'),notRequiredEvidence:items.filter(item=>item.state==='NOT_REQUIRED'),
    finalRiskCheck:{status:result.verdict==='AUTHORIZED'?'PASSED':result.verdict==='WAIT'?'INCOMPLETE':'FAILED',entryPrice:input.entry,stopPrice:input.stopLoss,targetPrice:input.takeProfit,riskReward:result.rr,riskPercent:input.riskPercent,blockingReasons:[...result.vetoes]},
    integrityStatement:explanation.integrityStatement,limitations,deterministicFingerprint:'',createdAt,
  };
  return {...base,deterministicFingerprint:deterministicFingerprint(base as unknown as Record<string,unknown>)};
}
