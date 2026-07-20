export type Instrument = string;
export type Direction = 'BUY' | 'SELL';
export type Session = string;
export type Verdict = 'AUTHORIZED' | 'WAIT' | 'REJECTED';
export type SetupType =
  | 'Liquidity Sweep + ChoCH + BoS'
  | 'FVG Retest'
  | 'Order Block Retest'
  | 'Breakout Retest'
  | 'Continuation'
  | 'Reversal'
  | 'Unclear'
  | string;

export type EvidenceKey =
  | 'h4TrendAligned'
  | 'h1TrendAligned'
  | 'structurePattern'
  | 'liquiditySweep'
  | 'chochConfirmed'
  | 'bosConfirmed'
  | 'orderBlock'
  | 'fairValueGap'
  | 'retestConfirmed';

export type StopMethod =
  | 'PIPS'
  | 'POINTS'
  | 'TICKS'
  | 'PERCENT'
  | 'ATR'
  | 'STRUCTURAL';

export type StrategySession = {
  id?: string;
  sessionCode: string;
  name: string;
  timezone: string;
  startTime: string;
  endTime: string;
  days: number[];
  allowOpenOutside: boolean;
  allowHoldOutside: boolean;
  isCustom?: boolean;
};

export type StrategyRule = {
  ruleKey: string;
  label: string;
  enabled: boolean;
  mandatory: boolean;
  weight: number;
  minimumConfidence: number;
  timeframeRole: 'MACRO' | 'TREND' | 'CONFIRMATION' | 'ENTRY' | 'TRIGGER';
  evaluationMode?: 'AUTOMATIC' | 'MANUAL';
};

export type TimeframeRole='MACRO'|'TREND'|'CONFIRMATION'|'ENTRY'|'TRIGGER';
export type MarketBias='BULLISH'|'BEARISH'|'RANGE'|'UNCLEAR';
export type TimeframeLayer={role:TimeframeRole;timeframe:string};
export type LayerAnalysis=TimeframeLayer&{bias:MarketBias;confirmedEvidence:string[];missingEvidence:string[];confidence:number|null};
export type ManualConfirmation={evidenceKey:EvidenceKey;confirmed:boolean;note?:string};

export type StopLimit = {
  instrument: string;
  method: StopMethod;
  minimumValue?: number;
  preferredValue?: number;
  maximumValue: number;
  atrMultiplier?: number;
};

export type TradingStyle = 'scalping' | 'day-trading' | 'swing' | 'position';
export type AIBehaviorProfile = {
  tone: 'direct' | 'educational' | 'analytical' | 'mentor';
  strictness: 'conservative' | 'balanced' | 'opportunistic';
  confidenceThreshold: number;
  explainDecisions: boolean;
  suggestAlternatives: boolean;
  useDisplayName: boolean;
};

export type AICommentary = {
  headline: string;
  message: string;
  nextAction: string;
  passed: string[];
  missing: string[];
  violated: string[];
  tone: AIBehaviorProfile['tone'];
  spokenText: string;
};

export type StrategyMethodology = { category: string; rules: string[] };
export type PersonalTradingRule = { key: string; enabled: boolean; value?: string | number | boolean | string[] };

export type StrategyProfile = {
  id?: string;
  engineVersion?: number;
  name: string;
  description?: string;
  isDefault?: boolean;
  isArchived?: boolean;
  marketTypes?: string[];
  instruments: Instrument[];
  macroTimeframe?: string;
  trendTimeframe: string;
  confirmationTimeframe: string;
  entryTimeframe: string;
  triggerTimeframe?: string;
  minimumRR: number;
  preferredRR?: number;
  maximumRiskPercent: number;
  maximumDailyRiskPercent?: number;
  maximumWeeklyRiskPercent?: number;
  maximumDailyLossPercent?: number;
  maximumTotalExposurePercent?: number;
  maximumCurrencyExposurePercent?: number;
  maximumTradesPerDay: number;
  instrumentTradeLimits?: Record<Instrument, number>;
  greenDayProtectionEnabled?: boolean;
  greenDayProtectedFloorMode?: 'ZERO' | 'FIXED' | 'PERCENT_OF_PROFIT';
  greenDayProtectedFloorValue?: number;
  greenDayMaxExtraTrades?: number;
  greenDayExtraRiskMultiplier?: number;
  greenDayRequireAuthorized?: boolean;
  maximumConsecutiveLosses?: number;
  allowedSessions: Session[];
  sessions?: StrategySession[];
  avoidHighImpactNews: boolean;
  newsMode?: 'ALL_HIGH_IMPACT' | 'RELEVANT_CURRENCIES' | 'ALLOW';
  newsBlockMinutesBefore?: number;
  newsBlockMinutesAfter?: number;
  newsCurrencies?: string[];
  requireTrendAlignment: boolean;
  requiredEvidence: EvidenceKey[];
  evidenceWeights: Record<EvidenceKey, number>;
  rules?: StrategyRule[];
  stopLimits: Record<Instrument, number>;
  stopLimitSettings?: StopLimit[];
  authorizationScore: number;
  waitScore: number;
  lossStreakLimit: number;
  preferredSetups?: string[];
  rejectUnlistedSetups?: boolean;
  trailingConfig?: Record<string, unknown>;
  exitConfig?: Record<string, unknown>;
  monitorConfig?: Record<string, unknown>;
  tradingStyle?: TradingStyle;
  minimumHoldingMinutes?: number;
  strategyMethodologies?: StrategyMethodology[];
  personalRules?: PersonalTradingRule[];
  aiBehavior?: AIBehaviorProfile;
};

export const DEFAULT_STRATEGY_PROFILE: StrategyProfile = {
  engineVersion: 2,
  name: 'Chris Core Strategy',
  description: 'Core multi-timeframe rules for disciplined execution.',
  isDefault: true,
  isArchived: false,
  marketTypes: ['FOREX'],
  instruments: ['XAUUSD', 'GBPUSD', 'GBPJPY'],
  macroTimeframe: 'D1',
  trendTimeframe: 'H4',
  confirmationTimeframe: 'H1',
  entryTimeframe: 'M30',
  triggerTimeframe: 'M5',
  minimumRR: 3,
  preferredRR: 4,
  maximumRiskPercent: 0.5,
  maximumDailyRiskPercent: 1.5,
  maximumWeeklyRiskPercent: 4,
  maximumDailyLossPercent: 2,
  maximumTotalExposurePercent: 2,
  maximumCurrencyExposurePercent: 1,
  maximumTradesPerDay: 2,
  instrumentTradeLimits: { XAUUSD: 2, GBPUSD: 2, GBPJPY: 2 },
  greenDayProtectionEnabled: true,
  greenDayProtectedFloorMode: 'ZERO',
  greenDayProtectedFloorValue: 0,
  greenDayMaxExtraTrades: 1,
  greenDayExtraRiskMultiplier: 0.5,
  greenDayRequireAuthorized: true,
  maximumConsecutiveLosses: 5,
  allowedSessions: ['LONDON', 'NEW_YORK'],
  avoidHighImpactNews: true,
  newsMode: 'RELEVANT_CURRENCIES',
  newsBlockMinutesBefore: 30,
  newsBlockMinutesAfter: 15,
  newsCurrencies: ['USD', 'GBP', 'JPY'],
  requireTrendAlignment: true,
  requiredEvidence: [
    'h4TrendAligned',
    'h1TrendAligned',
    'structurePattern',
    'liquiditySweep',
    'chochConfirmed',
    'bosConfirmed',
  ],
  evidenceWeights: {
    h4TrendAligned: 10,
    h1TrendAligned: 10,
    structurePattern: 10,
    liquiditySweep: 10,
    chochConfirmed: 10,
    bosConfirmed: 10,
    orderBlock: 7,
    fairValueGap: 7,
    retestConfirmed: 6,
  },
  stopLimits: { XAUUSD: 2, GBPUSD: 0.003, GBPJPY: 0.3 },
  stopLimitSettings: [
    { instrument: 'XAUUSD', method: 'POINTS', maximumValue: 300 },
    { instrument: 'GBPUSD', method: 'PIPS', maximumValue: 25 },
    { instrument: 'GBPJPY', method: 'PIPS', maximumValue: 40 },
  ],
  authorizationScore: 80,
  waitScore: 70,
  lossStreakLimit: 5,
  preferredSetups: [
    'Liquidity Sweep Reversal',
    'Trend Continuation',
    'Breakout and Retest',
  ],
  rejectUnlistedSetups: false,
  aiBehavior:{tone:'analytical',strictness:'conservative',confidenceThreshold:80,explainDecisions:true,suggestAlternatives:true,useDisplayName:true},
};

export type TradeInput = {
  instrument: Instrument;
  direction: Direction;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  accountBalance: number;
  riskPercent: number;
  tradesToday: number;
  session: Session;
  highImpactNews: boolean;
  h4TrendAligned: boolean;
  h1TrendAligned: boolean;
  structurePattern: boolean;
  liquiditySweep: boolean;
  chochConfirmed: boolean;
  bosConfirmed: boolean;
  orderBlock: boolean;
  fairValueGap: boolean;
  retestConfirmed: boolean;
  setupType?: SetupType;
  setupConfidence?: number;
  manualConfirmations?: ManualConfirmation[];
  strategyProfile?: StrategyProfile;
};

export type ScoreItem = { label: string; earned: number; possible: number };
export type TradeResult = {
  score: number;
  grade: 'A+' | 'A' | 'B' | 'C';
  verdict: Verdict;
  rr: number;
  riskAmount: number;
  stopDistance: number;
  vetoes: string[];
  observations: string[];
  scoreItems: ScoreItem[];
  direction?: Direction;
  overrideAllowed?: boolean;
  dailyLimits?: {
    strategyTradesToday: number;
    strategyLimit: number;
    instrumentTradesToday: number;
    instrumentLimit: number;
    extraTradesUsed: number;
    extraTradesAllowed: number;
    realizedDailyPnl: number;
    openRisk: number;
    protectedFloor: number;
    worstCaseDailyPnl: number;
    greenDayExceptionApplied: boolean;
    message?: string;
  };
};

export type EvidenceAssessment = {
  value: boolean;
  confidence: number;
  reason: string;
};
export type EntryCandidate = {
  id: string;
  direction: Direction;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  rr: number | null;
  status: 'READY' | 'WAIT' | 'INVALID';
  rationale: string;
};
export type ChartAnalysis = {
  status: 'DATA_UNAVAILABLE'|'INSUFFICIENT_DATA'|'STRATEGY_UNSUPPORTED'|'STRATEGY_INCOMPLETE'|'ANALYSIS_FAILED'|'NO_RELEVANT_EVIDENCE'|'VALID_ANALYSIS';
  analysisStatus: 'DATA_UNAVAILABLE'|'INSUFFICIENT_DATA'|'STRATEGY_UNSUPPORTED'|'STRATEGY_INCOMPLETE'|'ANALYSIS_FAILED'|'NO_RELEVANT_EVIDENCE'|'VALID_ANALYSIS';
  instrument: Instrument;
  timeframe: string;
  strategyId: string | null;
  provider: string;
  calculatedAt: string;
  latestCandleTimestamp: string;
  detectedTimeframes: string[];
  layerAnalysis?: LayerAnalysis[];
  timeframeBiases?: Record<string,MarketBias>;
  h4Bias: MarketBias;
  h1Bias: MarketBias;
  suggestedDirection: Direction | null;
  setupType: SetupType;
  liveAnalysisConfidence: number | null;
  strategyConfidenceThreshold: number;
  evidence: Record<EvidenceKey, EvidenceAssessment>;
  candidates: EntryCandidate[];
  warnings: string[];
  summary: string;
  aiCommentary?: AICommentary;
  manualConfirmations?: ManualConfirmation[];
};
export type TradeOutcome = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'PARTIAL';
export type PostTradeAnalysis = {
  outcome: TradeOutcome;
  setupStillValid: boolean;
  executionQuality: 'GOOD' | 'MIXED' | 'POOR' | 'UNCLEAR';
  whatHappened: string;
  likelyFactors: string[];
  ruleViolations: string[];
  lesson: string;
  patternTag: string;
  confidence: number;
};
