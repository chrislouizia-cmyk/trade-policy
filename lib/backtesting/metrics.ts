import type { BacktestMetrics, SampleSizeQuality, SimulatedTrade } from './types.ts';

export function classifySampleSize(total: number): SampleSizeQuality {
  return total < 100 ? 'INSUFFICIENT' : total < 500 ? 'LIMITED' : total < 1_000 ? 'MODERATE' : total < 2_000 ? 'STRONG' : 'HIGH';
}
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const roundSafe = (value: number) => Math.abs(value) < 1e-12 ? 0 : value;

export function calculateMetrics(trades: readonly SimulatedTrade[], totalSignals = trades.length, startingBalance?: number): BacktestMetrics {
  const wins = trades.filter((trade) => trade.pnlR > 0), losses = trades.filter((trade) => trade.pnlR < 0), breakEven = trades.length - wins.length - losses.length;
  const results = trades.map((trade) => trade.pnlR), grossProfitR = wins.reduce((sum, trade) => sum + trade.pnlR, 0), grossLossR = losses.reduce((sum, trade) => sum + trade.pnlR, 0), netProfitR = grossProfitR + grossLossR;
  let equity = 0, peak = 0, maximumDrawdownR = 0, winStreak = 0, lossStreak = 0, longestWinningStreak = 0, longestLosingStreak = 0;
  for (const result of results) {
    equity += result; peak = Math.max(peak, equity); maximumDrawdownR = Math.max(maximumDrawdownR, peak - equity);
    winStreak = result > 0 ? winStreak + 1 : 0; lossStreak = result < 0 ? lossStreak + 1 : 0;
    longestWinningStreak = Math.max(longestWinningStreak, winStreak); longestLosingStreak = Math.max(longestLosingStreak, lossStreak);
  }
  const sorted = [...results].sort((a, b) => a - b);
  const median = sorted.length ? sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2 : null;
  const expectancy = results.length ? mean(results) : null;
  const standardDeviation = results.length > 1 && expectancy !== null ? Math.sqrt(results.reduce((sum, value) => sum + (value - expectancy) ** 2, 0) / (results.length - 1)) : null;
  const longCount = trades.filter((trade) => trade.direction === 'LONG').length;
  return Object.freeze({
    totalSignals, totalExecutedTrades: trades.length, wins: wins.length, losses: losses.length, breakEvenTrades: breakEven,
    winRate: trades.length ? wins.length / trades.length : 0, lossRate: trades.length ? losses.length / trades.length : 0,
    grossProfitR: roundSafe(grossProfitR), grossLossR: roundSafe(grossLossR), netProfitR: roundSafe(netProfitR),
    averageWinningTradeR: wins.length ? grossProfitR / wins.length : null, averageLosingTradeR: losses.length ? grossLossR / losses.length : null,
    expectancyR: expectancy, profitFactor: grossLossR < 0 ? grossProfitR / Math.abs(grossLossR) : grossProfitR > 0 ? null : 0,
    maximumDrawdownR, maximumDrawdownPercent: startingBalance && startingBalance > 0 ? maximumDrawdownR / startingBalance * 100 : null,
    longestWinningStreak, longestLosingStreak, averageBarsHeld: trades.length ? mean(trades.map((trade) => trade.barsHeld)) : null,
    medianTradeResultR: median, standardDeviationR: standardDeviation, tradeReturnSharpeLike: standardDeviation && expectancy !== null ? expectancy / standardDeviation * Math.sqrt(results.length) : null,
    longTradePercent: trades.length ? longCount / trades.length : 0, shortTradePercent: trades.length ? (trades.length - longCount) / trades.length : 0,
    sampleSizeQuality: classifySampleSize(trades.length),
  });
}
