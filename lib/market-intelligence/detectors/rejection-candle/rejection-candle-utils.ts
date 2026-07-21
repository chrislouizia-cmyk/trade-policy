import { candleAnatomy } from '../../analysis-utils/index.ts';
import type { NormalizedCandle, RejectionCandleObservation } from '../../contracts.ts';

/** Exact legacy rejection classification; ratios are descriptive only. */
export function calculateLegacyRejectionCandle(timeframe: string, candle: NormalizedCandle): RejectionCandleObservation | null {
  const anatomy = candleAnatomy(candle);
  if (!anatomy) return null;
  const upperRejection = anatomy.upperWick > anatomy.bodySize * 1.5;
  const lowerRejection = anatomy.lowerWick > anatomy.bodySize * 1.5;
  const classification = upperRejection && lowerRejection ? 'BOTH' : upperRejection ? 'UPPER' : lowerRejection ? 'LOWER' : 'NONE';
  return { timeframe, classification, rejectionDetected: upperRejection || lowerRejection, upperRejection, lowerRejection, ...anatomy, open: candle.open, high: candle.high, low: candle.low, close: candle.close, candleCount: 1, sourceStartTime: candle.openedAt, sourceEndTime: candle.openedAt, eventCandleTime: candle.openedAt };
}
