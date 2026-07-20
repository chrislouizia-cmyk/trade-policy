import type { EvidenceKey, TimeframeRole, Verdict } from './trade';

export type CopilotRecommendation = 'ENTER' | 'WAIT' | 'BLOCK';
export type DecisionReasonCategory =
  | 'EVIDENCE'
  | 'RISK'
  | 'SESSION'
  | 'NEWS'
  | 'DAILY_LIMIT'
  | 'SETUP'
  | 'DATA'
  | 'DISCIPLINE';

export type DecisionReason = {
  id: string;
  code: string;
  category: DecisionReasonCategory;
  status: 'PASSED' | 'MISSING' | 'FAILED' | 'ADVISORY';
  origin: 'AUTOMATIC_RULE' | 'MANUAL_RULE' | 'STRATEGY' | 'RISK_ENGINE' | 'SYSTEM';
  message: string;
  evidenceKey?: EvidenceKey;
  ruleKey?: string;
  layer?: number;
  timeframe?: string;
  blocking: boolean;
};

export type MissingEvidenceItem = {
  id: string;
  evidenceKey: EvidenceKey;
  ruleKey: string;
  label: string;
  layer?: number;
  timeframe?: string;
  evaluationMode: 'AUTOMATIC' | 'MANUAL';
  mandatory: boolean;
  detected: boolean | null;
  confidence: number | null;
  minimumConfidence?: number;
  reason: string;
  canUserConfirm: boolean;
};

export type NextActionType =
  | 'WAIT_FOR_EVIDENCE'
  | 'CONFIRM_MANUAL_EVIDENCE'
  | 'REVIEW_RISK'
  | 'RUN_ANALYSIS'
  | 'REVIEW_ENTRY'
  | 'DO_NOT_TRADE';

export type NextAction = {
  id: string;
  type: NextActionType;
  priority: number;
  label: string;
  rationale: string;
  blocking: boolean;
  relatedEvidenceIds: string[];
};

export type StrategyContextSummary = {
  complete: boolean;
  missingFields: string[];
  strategyId: string | null;
  strategyName: string | null;
  engineVersion: number | null;
  confidenceThreshold: number | null;
  fiveLayerModel: Array<{ layer: number; role: TimeframeRole; timeframe: string }>;
  mandatoryRuleCount: number;
  optionalRuleCount: number;
  automaticRuleCount: number;
  manualRuleCount: number;
  permittedSessions: string[];
  allowedSetups: string[] | null;
  riskPolicy: {
    maxRiskPercentage: number | null;
    minimumRiskReward: number | null;
  };
};

export type DecisionNarrative = {
  version: '1';
  recommendation: CopilotRecommendation;
  engineVerdict: Verdict;
  source: 'DETERMINISTIC' | 'AI_ENHANCED';
  headline: string;
  explanation: string;
  reasons: DecisionReason[];
  missingEvidence: MissingEvidenceItem[];
  nextActions: NextAction[];
  strategyContext: StrategyContextSummary;
  readiness: {
    currentScore: number | null;
    requiredScore: number | null;
    label: 'Evidence readiness';
    isProbability: false;
  };
  disciplineMessage: string;
  educationalExplanation?: string;
  coachingMessage?: string;
  learningTip?: string;
  generatedAt: string;
  fallbackUsed: boolean;
};
