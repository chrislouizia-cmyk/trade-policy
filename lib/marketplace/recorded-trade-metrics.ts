export type MarketplaceRecordedTrade = Readonly<{
  id: string;
  closedAt: string;
  resultR: number;
  takenAgainstVerdict: boolean;
}>;

export type MarketplaceRecordedTradeMetrics = Readonly<{
  tradeCount: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  lossRate: number | null;
  totalR: number | null;
  averageR: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  bestTradeR: number | null;
  worstTradeR: number | null;
  maxWinStreak: number | null;
  maxLossStreak: number | null;
  maxDrawdownR: number | null;
  adherencePercent: number | null;
  ruleViolationCount: number;
  equityCurve: ReadonlyArray<Readonly<{ index: number; cumulativeR: number }>>;
}>;

const round = (value: number, decimals = 4) => Number(value.toFixed(decimals));

// close_trade_v2 uses the same +/-0.05R boundary when it records an outcome.
export const marketplaceTradeOutcome = (resultR: number) =>
  resultR > 0.05 ? 'WIN' : resultR < -0.05 ? 'LOSS' : 'BREAKEVEN';

export function deriveMarketplaceRecordedTradeMetrics(
  input: ReadonlyArray<MarketplaceRecordedTrade>,
): MarketplaceRecordedTradeMetrics {
  const trades = [...input]
    .filter((trade) => Number.isFinite(trade.resultR) && Number.isFinite(Date.parse(trade.closedAt)))
    .sort((left, right) => Date.parse(left.closedAt) - Date.parse(right.closedAt) || left.id.localeCompare(right.id));

  if (!trades.length) {
    return {
      tradeCount: 0,
      wins: 0,
      losses: 0,
      breakeven: 0,
      winRate: null,
      lossRate: null,
      totalR: null,
      averageR: null,
      expectancyR: null,
      profitFactor: null,
      bestTradeR: null,
      worstTradeR: null,
      maxWinStreak: null,
      maxLossStreak: null,
      maxDrawdownR: null,
      adherencePercent: null,
      ruleViolationCount: 0,
      equityCurve: [],
    };
  }

  let cumulativeR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let grossProfitR = 0;
  let grossLossR = 0;

  const equityCurve: Array<{ index: number; cumulativeR: number }> = [{ index: 0, cumulativeR: 0 }];
  for (const [index, trade] of trades.entries()) {
    const outcome = marketplaceTradeOutcome(trade.resultR);
    cumulativeR += trade.resultR;
    peakR = Math.max(peakR, cumulativeR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - cumulativeR);
    equityCurve.push({ index: index + 1, cumulativeR: round(cumulativeR) });

    if (trade.resultR > 0) grossProfitR += trade.resultR;
    if (trade.resultR < 0) grossLossR += Math.abs(trade.resultR);

    if (outcome === 'WIN') {
      wins += 1;
      currentWinStreak += 1;
      currentLossStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
    } else if (outcome === 'LOSS') {
      losses += 1;
      currentLossStreak += 1;
      currentWinStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    } else {
      breakeven += 1;
      currentWinStreak = 0;
      currentLossStreak = 0;
    }
  }

  const ruleViolationCount = trades.filter((trade) => trade.takenAgainstVerdict).length;
  return {
    tradeCount: trades.length,
    wins,
    losses,
    breakeven,
    winRate: round((wins / trades.length) * 100, 2),
    lossRate: round((losses / trades.length) * 100, 2),
    totalR: round(cumulativeR),
    averageR: round(cumulativeR / trades.length),
    expectancyR: round(cumulativeR / trades.length),
    profitFactor: grossLossR > 0 ? round(grossProfitR / grossLossR) : null,
    bestTradeR: round(Math.max(...trades.map((trade) => trade.resultR)), 4),
    worstTradeR: round(Math.min(...trades.map((trade) => trade.resultR)), 4),
    maxWinStreak: maxWinStreak || null,
    maxLossStreak: maxLossStreak || null,
    maxDrawdownR: round(maxDrawdownR),
    adherencePercent: round(((trades.length - ruleViolationCount) / trades.length) * 100, 2),
    ruleViolationCount,
    equityCurve,
  };
}
