import type { DecisionExplanationState, DecisionExplanationVerdict } from './intelligence';

export const HISTORICAL_DECISION_SCHEMA_VERSION = '1.0.0' as const;

export type HistoricalDecisionEvidenceItem = {
  id: string; ruleId?: string; title: string; description: string;
  state: DecisionExplanationState; required: boolean; supported: boolean;
  observedValue?: string; expectedValue?: string; detectedAt?: string; source?: string;
  nextAction?: string; evidenceIds: string[]; deterministic: true;
};

export type HistoricalDecisionReportSnapshot = {
  reportId: string; schemaVersion: typeof HISTORICAL_DECISION_SCHEMA_VERSION; userId: string;
  verdict: DecisionExplanationVerdict; readinessPercent?: number;
  confirmedRequiredCount: number; totalRequiredCount: number;
  confirmedOptionalCount: number; totalOptionalCount: number;
  headline: string; explanation: string; primaryReason: string; nextAction: string;
  instrument: string; timeframe: string;
  strategyId: string; strategyName: string; strategyRevisionId?: string; strategyVersion?: string;
  marketData: { provider: string; lastVerifiedCandleAt?: string; candleAgeSeconds?: number; freshness: 'CURRENT'|'DELAYED'|'MARKET_CLOSED'|'UNAVAILABLE'; calculationCompletedAt?: string };
  requiredRules: HistoricalDecisionEvidenceItem[]; helpfulConfirmations: HistoricalDecisionEvidenceItem[];
  blockingConditions: HistoricalDecisionEvidenceItem[]; unavailableEvidence: HistoricalDecisionEvidenceItem[];
  notRequiredEvidence?: HistoricalDecisionEvidenceItem[];
  finalRiskCheck?: { status: 'NOT_RUN'|'PASSED'|'FAILED'|'INCOMPLETE'; entryPrice?: number; stopPrice?: number; targetPrice?: number; riskReward?: number; riskPercent?: number; blockingReasons: string[] };
  integrityStatement: string; limitations: string[]; deterministicFingerprint: string; createdAt: string;
};

export type HistoricalDecisionAiExplanation = {
  reportId: string; explanationVersion: string; provider?: string; model?: string; prose: string;
  createdAt: string; sourceVerdict: DecisionExplanationVerdict;
  sourceDeterministicFingerprint: string; authoritative: false;
};
