import type { Iso8601String, JsonObject, NormalizedCandle } from '../../contracts.ts';

export type SwingDirection = 'HIGH' | 'LOW';
export type SwingEqualityPolicy = 'STRICT' | 'ALLOW_EQUAL_LEFT' | 'ALLOW_EQUAL_RIGHT' | 'ALLOW_EQUAL_BOTH';

export type SwingDetectorContext = JsonObject & {
  instrument?: string;
  timeframe?: string;
  datasetId?: string;
};

export type SwingDetectorConfig = JsonObject & {
  leftBars: number;
  rightBars: number;
  equalityPolicy: SwingEqualityPolicy;
  minimumProminence?: number;
  minimumProminenceAtrMultiple?: number;
  atrPeriod?: number;
  context?: SwingDetectorContext;
};

export type SwingSourceCandle = JsonObject & Pick<NormalizedCandle, 'open' | 'high' | 'low' | 'close'>;

export type ConfirmedSwing = JsonObject & {
  id: string;
  direction: SwingDirection;
  pivotIndex: number;
  confirmedIndex: number;
  /** Candidate candle openedAt. The pivot is not knowable at this time. */
  pivotAt: Iso8601String;
  /** Final right-confirmation candle closedAt. This is the first-known time. */
  confirmedAt: Iso8601String;
  price: number;
  leftBars: number;
  rightBars: number;
  prominence: number;
  prominenceAtrMultiple: number | null;
  strength: number;
  equalPriceConflict: boolean;
  sourceCandle: SwingSourceCandle;
};

export type SwingDetectionResult = JsonObject & {
  swings: ConfirmedSwing[];
  warnings: string[];
  configuration: SwingDetectorConfig;
};

export type IncrementalSwingDetector = Readonly<{
  push(candle: NormalizedCandle): readonly ConfirmedSwing[];
  getNewlyConfirmedSwings(): readonly ConfirmedSwing[];
  getAllConfirmedSwings(): readonly ConfirmedSwing[];
  reset(): void;
}>;
