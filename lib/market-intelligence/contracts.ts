/**
 * Automatic Market Intelligence v1 contracts.
 *
 * These types form a JSON-only boundary: timestamps are ISO-8601 strings and
 * values must be composed from plain objects, arrays, primitives, and null.
 * Detector and decision confidence describe evidence certainty/completeness;
 * they are never a probability of profit.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type Iso8601String = string;

export type ObservationStatus =
  | 'DETECTED'
  | 'NOT_DETECTED'
  | 'INSUFFICIENT_DATA'
  | 'ERROR';

export type DataFreshness = {
  state: 'FRESH' | 'STALE' | 'UNKNOWN';
  dataAsOf: Iso8601String;
  ageMs: number;
  maximumAgeMs: number;
};

export type DetectorEvidence = {
  id: string;
  type: string;
  description: string;
  candleTimes?: Iso8601String[];
  priceLevels?: number[];
  source?: string;
  sourceReference?: string;
  metadata?: JsonObject;
};

export type DetectorResult<TPayload extends JsonValue = JsonValue> = {
  detectorId: string;
  detectorVersion: string;
  runId: string;
  instrument: string;
  timeframe: string;
  observedAt: Iso8601String;
  dataAsOf: Iso8601String;
  status: ObservationStatus;
  /** Detector certainty/evidence completeness, never probability of profit. */
  confidence: number | null;
  /** Null whenever status is INSUFFICIENT_DATA or ERROR. */
  payload: TPayload | null;
  evidence: DetectorEvidence[];
  freshness: DataFreshness;
  warnings: string[];
  errorCode?: string;
};

export type NormalizedCandle = {
  openedAt: Iso8601String;
  closedAt: Iso8601String;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  complete: boolean;
};

export type MarketDataSnapshot = {
  id: string;
  snapshotVersion: string;
  provider: string;
  providerVersion: string;
  providerSymbol: string;
  instrument: string;
  timeframe: string;
  requestedAt: Iso8601String;
  receivedAt: Iso8601String;
  dataAsOf: Iso8601String;
  freshness: DataFreshness;
  candles: NormalizedCandle[];
  currentPrice?: number;
  spread?: number;
  validationWarnings: string[];
};

export type SessionObservation = JsonObject & {
  sessionId: string;
  sessionName: string;
  market: string;
  timezone: string;
  status: 'OPEN' | 'OPENING_SOON' | 'CLOSING_SOON' | 'CLOSED';
  startTime: Iso8601String;
  endTime: Iso8601String;
  minutesUntilOpen: number | null;
  minutesUntilClose: number | null;
  isWeekend: boolean;
  isHoliday: boolean | null;
  overlappingSessions: SessionWindowObservation[];
};

export type SessionWindowObservation = JsonObject & {
  sessionId: string;
  sessionName: string;
  market: string;
  timezone: string;
  startTime: Iso8601String;
  endTime: Iso8601String;
};

export type NewsObservation = JsonObject & {
  eventId: string;
  title: string;
  impact: string;
  currencies: string[];
  scheduledAt: Iso8601String;
};

export type TrendObservation = JsonObject & {
  timeframe: string;
  direction: 'BULLISH' | 'BEARISH' | 'RANGE';
  latestClose: number;
  fastAverage: { type: 'SMA'; period: 10; value: number };
  slowAverage: { type: 'SMA'; period: 24; value: number };
  fastSlowDifference: number;
  fastSlowDifferencePercent: number | null;
  closeToSlowDifference: number;
  closeToSlowDifferencePercent: number | null;
  candleCount: number;
  sourceStartTime: Iso8601String;
  sourceEndTime: Iso8601String;
  lastCandleTime: Iso8601String;
};

export type StructureObservation = JsonObject & {
  bias: 'BULLISH' | 'BEARISH' | 'RANGE' | 'UNCLEAR';
  structureType: string;
};

export type RangeLevelsObservation = JsonObject & {
  timeframe: string;
  recentHigh: number;
  recentLow: number;
  previousHigh: number;
  previousLow: number;
  midpoint: number;
  range: number;
  candleCount: number;
  sourceStartTime: Iso8601String;
  sourceEndTime: Iso8601String;
  lastCandleTime: Iso8601String;
};

export type BreakOfStructureObservation = JsonObject & {
  timeframe: string;
  direction: 'BULLISH' | 'BEARISH' | 'NONE';
  bullishBreak: boolean;
  bearishBreak: boolean;
  referenceHigh: number;
  referenceLow: number;
  currentOpen: number;
  currentHigh: number;
  currentLow: number;
  currentClose: number;
  breakPrice: number | null;
  breakDistance: number | null;
  breakDistancePercent: number | null;
  referenceWindowSize: number;
  candleCount: number;
  referenceStartTime: Iso8601String;
  referenceEndTime: Iso8601String;
  eventCandleTime: Iso8601String;
};

export type LiquiditySweepObservation = JsonObject & {
  timeframe: string;
  side: 'HIGH_SIDE' | 'LOW_SIDE' | 'BOTH' | 'NONE';
  highSideSweep: boolean;
  lowSideSweep: boolean;
  referenceHigh: number;
  referenceLow: number;
  currentOpen: number;
  currentHigh: number;
  currentLow: number;
  currentClose: number;
  highPenetration: number | null;
  lowPenetration: number | null;
  highPenetrationPercent: number | null;
  lowPenetrationPercent: number | null;
  closeReturnedInsideHigh: boolean;
  closeReturnedInsideLow: boolean;
  referenceWindowSize: number;
  candleCount: number;
  referenceStartTime: Iso8601String;
  referenceEndTime: Iso8601String;
  eventCandleTime: Iso8601String;
};

export type FairValueGapObservation = JsonObject & {
  timeframe: string;
  direction: 'BULLISH' | 'BEARISH' | 'NONE';
  bullishGap: boolean;
  bearishGap: boolean;
  gapTop: number | null;
  gapBottom: number | null;
  gapSize: number | null;
  gapSizePercent: number | null;
  currentCandle: { open: number; high: number; low: number; close: number };
  referenceCandle: { open: number; high: number; low: number; close: number };
  candleCount: number;
  sourceStartTime: Iso8601String;
  sourceEndTime: Iso8601String;
  referenceCandleTime: Iso8601String;
  eventCandleTime: Iso8601String;
};

export type RejectionCandleObservation = JsonObject & {
  timeframe: string;
  classification: 'UPPER' | 'LOWER' | 'BOTH' | 'NONE';
  rejectionDetected: boolean;
  upperRejection: boolean;
  lowerRejection: boolean;
  bodySize: number;
  fullRange: number;
  upperWick: number;
  lowerWick: number;
  bodyToRangeRatio: number | null;
  upperWickToBodyRatio: number | null;
  lowerWickToBodyRatio: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  candleCount: number;
  sourceStartTime: Iso8601String;
  sourceEndTime: Iso8601String;
  eventCandleTime: Iso8601String;
};

export type VolumeExpansionObservation = JsonObject & {
  timeframe: string;
  classification: 'EXPANDED' | 'NOT_EXPANDED';
  expansionDetected: boolean;
  volumeAvailable: boolean;
  currentVolume: number | null;
  previousVolume: number | null;
  multiplier: 1.15;
  thresholdVolume: number | null;
  volumeIncrease: number | null;
  volumeRatio: number | null;
  volumeChangePercent: number | null;
  candleCount: number;
  sourceStartTime: Iso8601String;
  sourceEndTime: Iso8601String;
  previousCandleTime: Iso8601String;
  eventCandleTime: Iso8601String;
};

export type DisplacementObservation = JsonObject & {
  timeframe: string;
  classification: 'DISPLACEMENT' | 'NOT_DISPLACEMENT';
  displacementDetected: boolean;
  bodySize: number;
  fullRange: number;
  bodyToRangeRatio: number | null;
  atr: number;
  atrPeriod: 14;
  atrSmoothingMethod: 'SIMPLE';
  atrThresholdMultiplier: 1.1;
  atrThreshold: number;
  bodyRatioThresholdMultiplier: 0.65;
  bodyRatioThreshold: number;
  effectiveThreshold: number;
  distanceAboveEffectiveThreshold: number;
  bodyAboveAtrThreshold: boolean;
  bodyAboveRangeThreshold: boolean;
  open: number;
  high: number;
  low: number;
  close: number;
  candleCount: number;
  trueRangeCount: number;
  sourceStartTime: Iso8601String;
  sourceEndTime: Iso8601String;
  eventCandleTime: Iso8601String;
};

export type VolatilityRequirementObservation = JsonObject & {
  timeframe: string;
  classification: 'REQUIREMENT_MET' | 'REQUIREMENT_NOT_MET';
  volatilityRequirementMet: boolean;
  currentRange: number;
  atr: number;
  atrPeriod: 14;
  atrSmoothingMethod: 'SIMPLE';
  thresholdMultiplier: 0.8;
  volatilityThreshold: number;
  rangeToAtrRatio: number | null;
  distanceFromThreshold: number;
  rangeAtOrAboveThreshold: boolean;
  atrPositive: boolean;
  open: number;
  high: number;
  low: number;
  close: number;
  candleCount: number;
  trueRangeCount: number;
  sourceStartTime: Iso8601String;
  sourceEndTime: Iso8601String;
  eventCandleTime: Iso8601String;
};

export type RetestObservation = JsonObject & {
  timeframe: string;
  classification: 'RETEST' | 'NO_RETEST';
  retestDetected: boolean;
  trendBias: 'BULLISH' | 'BEARISH' | 'RANGE';
  targetLevel: number;
  recentHigh: number;
  recentLow: number;
  tolerance: number;
  atrTolerance: number;
  priceTolerance: number;
  distanceToTarget: number;
  atr: number;
  atrPeriod: 14;
  atrSmoothingMethod: 'SIMPLE';
  currentClose: number;
  candleCount: number;
  atrCandleCount: number;
  trueRangeCount: number;
  recentWindowSize: number;
  sourceStartTime: Iso8601String;
  sourceEndTime: Iso8601String;
  recentStartTime: Iso8601String;
  recentEndTime: Iso8601String;
  eventCandleTime: Iso8601String;
};

export type VolatilityObservation = JsonObject & {
  state: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' | 'UNKNOWN';
};

export type AtrObservation = JsonObject & {
  timeframe: string;
  atr: number;
  period: number;
  smoothingMethod: 'SIMPLE';
  candleCount: number;
  trueRangeCount: number;
  unit: 'RAW_PRICE';
  normalizedAtrPercent: number | null;
  sourceStartTime: Iso8601String;
  sourceEndTime: Iso8601String;
  lastCandleTime: Iso8601String;
};

export type LiquidityObservation = JsonObject & {
  zoneId: string;
  kind: string;
  low: number;
  high: number;
};

export type OrderBlockObservation = JsonObject & {
  orderBlockId: string;
  direction: 'BULLISH' | 'BEARISH';
  low: number;
  high: number;
};

export type ContextConflict = {
  id: string;
  type: string;
  description: string;
  detectorIds: string[];
  timeframes: string[];
  evidenceIds: string[];
  severity: 'INFO' | 'WARNING' | 'ERROR';
};

/** @deprecated Use ContextConflict. */
export type MarketContextConflict = ContextConflict;

export type MarketContext = {
  contextId: string;
  contextVersion: string;
  instrument: string;
  provider: string;
  providerVersion: string;
  timeframes: string[];
  snapshotId: string;
  snapshotVersion: string;
  snapshotFreshness: DataFreshness;
  detectorRunId: string;
  detectorResults: DetectorResult[];
  detectorResultsByTimeframe: Record<string, DetectorResult[]>;
  warnings: string[];
  conflicts: ContextConflict[];
  overallFreshness: DataFreshness['state'];
  overallConfidence: number | null;
  dataAsOf: Iso8601String;
  /** Original immutable snapshot request time for deterministic downstream composition. */
  requestedAt?: Iso8601String;
  generatedAt: Iso8601String;
};

export type StrategyRuleMode = 'OFF' | 'OPTIONAL' | 'REQUIRED' | 'PREFERRED' | 'BLOCKING';
export type StrategyBlockingBehavior = 'NONE' | 'BLOCK_ON_MATCH' | 'BLOCK_ON_FAILURE';
export type StrategyEvaluationStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'INSUFFICIENT_DATA';

export type StrategyRuleV3 = {
  id: string;
  ruleType: string;
  mode: StrategyRuleMode;
  parameters: JsonObject;
  applicableInstruments: string[];
  applicableTimeframes: string[];
  weight: number;
  blockingBehavior: StrategyBlockingBehavior;
  explanationLabel: string;
  detectorId?: string;
};

export type StrategyRuleResult = {
  ruleId: string;
  mode: StrategyRuleMode;
  status: StrategyEvaluationStatus;
  confidence: number | null;
  evidenceIds: string[];
  explanation: string;
  blockingReason?: string;
};

export type StrategyEvaluation = {
  id: string;
  strategyId: string;
  strategyVersion: number;
  engineVersion: string;
  /** BLOCKED has precedence regardless of compatibilityScore. */
  status: StrategyEvaluationStatus;
  compatibilityScore: number | null;
  ruleResults: StrategyRuleResult[];
  requiredRulesPassed: number;
  requiredRulesFailed: number;
  blockingRulesTriggered: number;
  evaluatedAt: Iso8601String;
};

export type RiskCalculationEvidence = {
  id: string;
  calculationType: string;
  formula: string;
  inputs: JsonObject;
  output: JsonValue;
  unit?: string;
  source?: string;
};

export type RiskEvaluation = {
  id: string;
  riskEngineVersion: string;
  status: 'ALLOWED' | 'REDUCED' | 'BLOCKED' | 'INSUFFICIENT_DATA';
  riskAllowed: boolean;
  suggestedRiskPercent: number | null;
  maximumPositionSize: number | null;
  stopDistanceValid: boolean | null;
  warnings: string[];
  blockReason?: string;
  calculations: RiskCalculationEvidence[];
  evaluatedAt: Iso8601String;
};

export type DecisionConfidenceMeaning = 'EVIDENCE_COMPLETENESS';

export type TradeDecision = {
  id: string;
  decisionEngineVersion: string;
  decision: 'BUY' | 'SELL' | 'WAIT' | 'BLOCKED' | 'INSUFFICIENT_DATA';
  /** Evidence completeness, never predicted chance of success or profit. */
  confidence: number | null;
  confidenceMeaning: DecisionConfidenceMeaning;
  direction?: 'LONG' | 'SHORT';
  primaryReason: string;
  supportingReasons: string[];
  blockingReasons: string[];
  warnings: string[];
  strategyCompatibility: number | null;
  riskAllowed: boolean;
  contextId: string;
  strategyEvaluationId: string;
  riskEvaluationId: string;
  generatedAt: Iso8601String;
};

export type AnalysisLifecycleState =
  | 'IDLE'
  | 'LOADING_MARKET_DATA'
  | 'RUNNING_DETECTORS'
  | 'BUILDING_CONTEXT'
  | 'EVALUATING_STRATEGY'
  | 'EVALUATING_RISK'
  | 'READY'
  | 'PARTIAL'
  | 'ERROR'
  | 'STALE';
