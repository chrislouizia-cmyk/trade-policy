export type TradeDirection = 'LONG' | 'SHORT';
export type StrategyDirection = 'LONG' | 'SHORT' | 'BOTH';
export type RuleSupportStatus = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED';
export type RuleOperator = 'ABOVE' | 'BELOW';

export type Candle = Readonly<{
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}>;

export type BacktestDataset = Readonly<{
  symbol: string;
  timeframe: string;
  timezone: string;
  candles: readonly Candle[];
  source: string;
  startTime: string;
  endTime: string;
}>;

type RuleBase = Readonly<{ id: string; required?: boolean }>;
export type ExecutableRule =
  | (RuleBase & { type: 'EMA_RELATION'; fastPeriod: number; slowPeriod: number; relation: RuleOperator })
  | (RuleBase & { type: 'CLOSE_VS_EMA'; period: number; relation: RuleOperator })
  | (RuleBase & { type: 'PRICE_CROSS_LEVEL'; level: number; direction: RuleOperator })
  | (RuleBase & { type: 'BREAKOUT'; lookback: number; direction: RuleOperator })
  | (RuleBase & { type: 'PULLBACK_AFTER_BREAKOUT'; lookback: number; maximumBarsSinceBreakout: number; direction: RuleOperator })
  | (RuleBase & { type: 'CANDLE_DIRECTION'; direction: 'BULLISH' | 'BEARISH' })
  | (RuleBase & { type: 'MIN_BODY_TO_RANGE'; minimumRatio: number })
  | (RuleBase & { type: 'VOLUME_VS_SMA'; period: number; multiplier: number })
  | (RuleBase & { type: 'ATR_THRESHOLD'; period: number; relation: RuleOperator; threshold: number })
  | (RuleBase & { type: 'SESSION'; startUtcMinute: number; endUtcMinute: number })
  | (RuleBase & { type: 'DAY_OF_WEEK'; allowedDaysUtc: readonly number[] })
  | (RuleBase & { type: 'MINIMUM_RR'; minimum: number });

export type PriceDistanceRule =
  | Readonly<{ type: 'FIXED_PRICE'; distance: number }>
  | Readonly<{ type: 'PERCENT'; percent: number }>
  | Readonly<{ type: 'ATR_MULTIPLE'; period: number; multiple: number }>;

export type ExecutableStrategy = Readonly<{
  id: string;
  name: string;
  version: string;
  direction: StrategyDirection;
  entryRules: readonly ExecutableRule[];
  forbiddenRules: readonly ExecutableRule[];
  stopLossRule: PriceDistanceRule;
  takeProfitRule: PriceDistanceRule;
  sessionFilter?: Extract<ExecutableRule, { type: 'SESSION' }>;
  volatilityFilter?: Extract<ExecutableRule, { type: 'ATR_THRESHOLD' }>;
  maximumHoldingPeriod?: number;
  minimumRequiredConfirmations: number;
}>;

export type RuleEvaluation = Readonly<{
  ruleId: string;
  type: ExecutableRule['type'];
  passed: boolean;
  reason: string;
}>;

export type Signal = Readonly<{
  timestamp: string;
  candleIndex: number;
  direction: TradeDirection;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  matchedRules: readonly string[];
  missingRules: readonly string[];
  blockedRules: readonly string[];
  evaluations: readonly RuleEvaluation[];
}>;

export type TradeOutcome = 'WIN' | 'LOSS' | 'BREAK_EVEN';
export type ExitReason = 'STOP_LOSS' | 'TAKE_PROFIT' | 'MAX_HOLDING_PERIOD' | 'END_OF_DATA';
export type SimulatedTrade = Readonly<{
  signalTimestamp: string;
  entryTimestamp: string;
  exitTimestamp: string;
  direction: TradeDirection;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  exitPrice: number;
  outcome: TradeOutcome;
  pnlR: number;
  maximumFavorableExcursionR: number;
  maximumAdverseExcursionR: number;
  barsHeld: number;
  exitReason: ExitReason;
}>;

export type EntryTiming = 'SIGNAL_CLOSE' | 'NEXT_OPEN';
export type IntrabarConflictPolicy = 'STOP_FIRST';
export type BacktestCosts = Readonly<{ commissionR: number; spreadPrice: number; slippagePrice: number }>;
export type SimulationConfiguration = Readonly<{
  entryTiming: EntryTiming;
  intrabarConflictPolicy: IntrabarConflictPolicy;
  allowOverlappingTrades: boolean;
  costs: BacktestCosts;
  startingBalance?: number;
  maximumHoldingBars: number;
}>;

export type SampleSizeQuality = 'INSUFFICIENT' | 'LIMITED' | 'MODERATE' | 'STRONG' | 'HIGH';
export type BacktestMetrics = Readonly<{
  totalSignals: number;
  totalExecutedTrades: number;
  wins: number;
  losses: number;
  breakEvenTrades: number;
  winRate: number;
  lossRate: number;
  grossProfitR: number;
  grossLossR: number;
  netProfitR: number;
  averageWinningTradeR: number | null;
  averageLosingTradeR: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  maximumDrawdownR: number;
  maximumDrawdownPercent: number | null;
  longestWinningStreak: number;
  longestLosingStreak: number;
  averageBarsHeld: number | null;
  medianTradeResultR: number | null;
  standardDeviationR: number | null;
  tradeReturnSharpeLike: number | null;
  longTradePercent: number;
  shortTradePercent: number;
  sampleSizeQuality: SampleSizeQuality;
}>;

export type ResearchClassification = 'INSUFFICIENT_DATA' | 'UNSTABLE' | 'NEGATIVE_EXPECTANCY' | 'PROMISING' | 'ROBUST_CANDIDATE';
export type ClassificationCriteria = Readonly<{
  robustMinimumTrades: number;
  robustMinimumOutOfSampleProfitFactor: number;
  maximumDrawdownR: number;
  maximumProfitConcentration: number;
  minimumOutOfSampleTrades: number;
  substantialProfitFactorChange: number;
}>;

export type ReproducibilityMetadata = Readonly<{
  engineVersion: string;
  runId: string;
  configurationHash: string;
  runTimestamp: string;
  deterministic: true;
}>;

export type BacktestSegmentResult = Readonly<{
  startTime: string;
  endTime: string;
  candleCount: number;
  signals: readonly Signal[];
  trades: readonly SimulatedTrade[];
  metrics: BacktestMetrics;
}>;

export type BacktestResult = Readonly<{
  configuration: SimulationConfiguration;
  strategy: ExecutableStrategy;
  datasetMetadata: Omit<BacktestDataset, 'candles'> & { candleCount: number };
  inSample: BacktestSegmentResult;
  outOfSample: BacktestSegmentResult;
  total: BacktestSegmentResult;
  trades: readonly SimulatedTrade[];
  metrics: BacktestMetrics;
  warnings: readonly string[];
  classification: ResearchClassification;
  reproducibility: ReproducibilityMetadata;
  walkForwardSupported: true;
}>;

export type StrategyDnaRuleInput = Readonly<{ id: string; concept: string; parameters?: Readonly<Record<string, unknown>>; required?: boolean; forbidden?: boolean }>;
export type StrategyDnaInput = Readonly<{
  id: string;
  name: string;
  version: string;
  direction: 'long' | 'short' | 'both';
  rules: readonly StrategyDnaRuleInput[];
  stopLoss: PriceDistanceRule;
  takeProfit: PriceDistanceRule;
  maximumHoldingPeriod?: number;
  minimumRequiredConfirmations?: number;
}>;
export type StrategyAdaptationIssue = Readonly<{ ruleId: string; concept: string; support: RuleSupportStatus; message: string }>;
export type StrategyAdaptationResult = Readonly<{ valid: boolean; strategy: ExecutableStrategy | null; issues: readonly StrategyAdaptationIssue[] }>;
