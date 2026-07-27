import type { Iso8601String, JsonObject, NormalizedCandle } from '../../contracts.ts';

export type FairValueGapDirection = 'BULLISH' | 'BEARISH';
export type FairValueGapStatus = 'ACTIVE' | 'PARTIALLY_MITIGATED' | 'FULLY_MITIGATED' | 'INVALIDATED' | 'EXPIRED';
export type FairValueGapLifecycleEventType = 'CREATED' | 'FIRST_TOUCH' | 'PARTIAL_MITIGATION' | 'FULL_MITIGATION' | 'INVALIDATION' | 'EXPIRATION';

export type FairValueGapConfig = JsonObject & {
  absoluteTolerance: number;
  relativeTolerance: number;
  minimumGapAbsolute: number;
  minimumGapRelative: number;
  minimumGapAtrMultiple: number;
  atrPeriod: number;
  gapDefinition: 'WICK_TO_WICK';
  mitigationPolicy: 'TOUCH' | 'PERCENT_FILLED' | 'FULL_FILL';
  partialMitigationThresholdPercent: number;
  fullMitigationThresholdPercent: number;
  invalidationPolicy: 'CLOSE_THROUGH_FAR_BOUNDARY' | 'WICK_THROUGH_FAR_BOUNDARY' | 'NONE';
  expirationPolicy: 'NEVER' | 'AFTER_N_CANDLES' | 'AFTER_N_MILLISECONDS';
  expirationCandles: number;
  expirationMilliseconds: number;
  overlappingGapPolicy: 'KEEP_SEPARATE' | 'MERGE_SAME_DIRECTION' | 'REJECT_NESTED';
  sameCandleLifecyclePolicy: 'CREATION_ONLY' | 'ALLOW_CREATION_AND_TOUCH';
  firstTouchTracking: boolean;
};

export type FairValueGap = JsonObject & {
  id: string;
  version: string;
  direction: FairValueGapDirection;
  status: FairValueGapStatus;
  lowerBound: number;
  upperBound: number;
  midpoint: number;
  gapSize: number;
  gapSizeRelative: number;
  gapSizeAtrMultiple: number | null;
  candle1Index: number;
  candle2Index: number;
  candle3Index: number;
  candle1Id: string;
  candle2Id: string;
  candle3Id: string;
  createdAt: Iso8601String;
  detectedAt: Iso8601String;
  firstTouchedAt: Iso8601String | null;
  partiallyMitigatedAt: Iso8601String | null;
  fullyMitigatedAt: Iso8601String | null;
  invalidatedAt: Iso8601String | null;
  expiredAt: Iso8601String | null;
  maximumFillPercent: number;
  remainingLowerBound: number | null;
  remainingUpperBound: number | null;
  middleCandleBody: number;
  middleCandleRange: number;
  sourceGapIds: string[];
  lifecycleEventIds: string[];
  evidence: string[];
  fingerprint: string;
};

export type FairValueGapLifecycleEvent = JsonObject & {
  id: string;
  version: string;
  fvgId: string;
  eventType: FairValueGapLifecycleEventType;
  direction: FairValueGapDirection;
  candleIndex: number;
  detectedAt: Iso8601String;
  priorStatus: FairValueGapStatus | null;
  newStatus: FairValueGapStatus;
  fillPercentBefore: number;
  fillPercentAfter: number;
  candleOpen: number;
  candleHigh: number;
  candleLow: number;
  candleClose: number;
  evidence: string[];
  fingerprint: string;
};

export type FairValueGapCandidate = JsonObject & {
  id: string;
  direction: FairValueGapDirection;
  candle1Index: number;
  candle2Index: number;
  candle3Index: number;
  lowerBound: number;
  upperBound: number;
  gapSize: number;
  detectedAt: Iso8601String;
  rejectionReason: string;
  fingerprint: string;
};

export type FairValueGapDetectionInput = Readonly<{ candles: readonly NormalizedCandle[]; config?: Partial<FairValueGapConfig> }>;
export type FairValueGapDetectionResult = JsonObject & {
  detectorVersion: string;
  gaps: FairValueGap[];
  lifecycleEvents: FairValueGapLifecycleEvent[];
  rejectedCandidates: FairValueGapCandidate[];
  warnings: string[];
  configuration: FairValueGapConfig;
};

export type IncrementalFairValueGapLifecycleDetector = Readonly<{
  pushCandle(candle: NormalizedCandle): readonly FairValueGap[];
  getNewGaps(): readonly FairValueGap[];
  getNewLifecycleEvents(): readonly FairValueGapLifecycleEvent[];
  getAllGaps(): readonly FairValueGap[];
  getActiveGaps(): readonly FairValueGap[];
  getTerminalGaps(): readonly FairValueGap[];
  getRejectedCandidates(): readonly FairValueGapCandidate[];
  getWarnings(): readonly string[];
  getResult(): FairValueGapDetectionResult;
  reset(): void;
}>;
