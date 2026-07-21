import type { StructuralWindow } from '../../analysis-utils/index.ts';
import type { BreakOfStructureObservation } from '../../contracts.ts';

export function calculateBreakOfStructure(timeframe: string, window: StructuralWindow): BreakOfStructureObservation {
  const { referenceCandles, eventCandle: current, referenceHigh, referenceLow } = window;
  const bullishBreak = current.close > referenceHigh; const bearishBreak = current.close < referenceLow;
  const direction = bullishBreak ? 'BULLISH' : bearishBreak ? 'BEARISH' : 'NONE';
  const breakPrice = bullishBreak ? referenceHigh : bearishBreak ? referenceLow : null;
  const breakDistance = bullishBreak ? current.close - referenceHigh : bearishBreak ? referenceLow - current.close : null;
  const breakDistancePercent = breakDistance === null || breakPrice === null || breakPrice === 0 ? null : breakDistance / Math.abs(breakPrice) * 100;
  return { timeframe, direction, bullishBreak, bearishBreak, referenceHigh, referenceLow, currentOpen: current.open, currentHigh: current.high, currentLow: current.low, currentClose: current.close, breakPrice, breakDistance, breakDistancePercent, referenceWindowSize: referenceCandles.length, candleCount: referenceCandles.length + 1, referenceStartTime: referenceCandles[0].openedAt, referenceEndTime: referenceCandles.at(-1)!.openedAt, eventCandleTime: current.openedAt };
}
