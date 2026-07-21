export type RangeLevelsCalculation = {
  recentHigh: number;
  recentLow: number;
  previousHigh: number;
  previousLow: number;
  midpoint: number;
  range: number;
  candleCount: number;
  sourceStartTime: string;
  sourceEndTime: string;
  lastCandleTime: string;
  evidenceTimes: string[];
};
