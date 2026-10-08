import type { Candle, Signal, SimulatedTrade, SimulationConfiguration, SkippedSignal, TradeDirection } from './types.ts';

const favorable = (direction: TradeDirection, price: number, entry: number) => direction === 'LONG' ? price - entry : entry - price;
const adverse = (direction: TradeDirection, price: number, entry: number) => direction === 'LONG' ? entry - price : price - entry;

export const DEFAULT_SIMULATION_CONFIGURATION: SimulationConfiguration = Object.freeze({
  entryTiming: 'NEXT_OPEN', intrabarConflictPolicy: 'STOP_FIRST', allowOverlappingTrades: false,
  costs: Object.freeze({ commissionR: 0, spreadPrice: 0, slippagePrice: 0 }), maximumHoldingBars: 100,
});

export function simulateTrade(signal: Signal, candles: readonly Candle[], configuration: SimulationConfiguration): SimulatedTrade | null {
  const entryIndex = configuration.entryTiming === 'NEXT_OPEN' ? signal.candleIndex + 1 : signal.candleIndex;
  const entryCandle = candles[entryIndex];
  if (!entryCandle) return null;
  const entryPrice = configuration.entryTiming === 'NEXT_OPEN' ? entryCandle.open : signal.entryPrice;
  const stopDistance = Math.abs(signal.entryPrice - signal.stopPrice);
  const targetDistance = Math.abs(signal.targetPrice - signal.entryPrice);
  const stopPrice = signal.direction === 'LONG' ? entryPrice - stopDistance : entryPrice + stopDistance;
  const targetPrice = signal.direction === 'LONG' ? entryPrice + targetDistance : entryPrice - targetDistance;
  let maximumFavorable = 0, maximumAdverse = 0;
  const maximumBars = Math.min(configuration.maximumHoldingBars, candles.length - entryIndex);
  let exitIndex = entryIndex, exitPrice = entryPrice, exitReason: SimulatedTrade['exitReason'] = 'END_OF_DATA';
  for (let held = 0; held < maximumBars; held += 1) {
    const index = entryIndex + held, candle = candles[index]!;
    maximumFavorable = Math.max(maximumFavorable, favorable(signal.direction, signal.direction === 'LONG' ? candle.high : candle.low, entryPrice));
    maximumAdverse = Math.max(maximumAdverse, adverse(signal.direction, signal.direction === 'LONG' ? candle.low : candle.high, entryPrice));
    const stopTouched = signal.direction === 'LONG' ? candle.low <= stopPrice : candle.high >= stopPrice;
    const targetTouched = signal.direction === 'LONG' ? candle.high >= targetPrice : candle.low <= targetPrice;
    exitIndex = index;
    if (stopTouched) { exitPrice = stopPrice; exitReason = 'STOP_LOSS'; break; }
    if (targetTouched) { exitPrice = targetPrice; exitReason = 'TAKE_PROFIT'; break; }
    if (held === maximumBars - 1) { exitPrice = candle.close; exitReason = index === candles.length - 1 ? 'END_OF_DATA' : 'MAX_HOLDING_PERIOD'; }
  }
  const rawPnlR = favorable(signal.direction, exitPrice, entryPrice) / stopDistance;
  const priceCostsR = (configuration.costs.spreadPrice + configuration.costs.slippagePrice * 2) / stopDistance;
  const costsR = priceCostsR + configuration.costs.commissionR;
  const pnlR = rawPnlR - costsR;
  const outcome = pnlR > 0 ? 'WIN' : pnlR < 0 ? 'LOSS' : 'BREAK_EVEN';
  return Object.freeze({ signalTimestamp: signal.timestamp, entryTimestamp: entryCandle.timestamp, exitTimestamp: candles[exitIndex]!.timestamp, direction: signal.direction, entryPrice, stopPrice, targetPrice, exitPrice, outcome, pnlR, rawPnlR, costsR, maximumFavorableExcursionR: maximumFavorable / stopDistance, maximumAdverseExcursionR: maximumAdverse / stopDistance, barsHeld: exitIndex - entryIndex + 1, exitReason });
}
export function simulateTrades(signals: readonly Signal[], candles: readonly Candle[], configuration: SimulationConfiguration): readonly SimulatedTrade[] {
  return simulateTradesWithSkips(signals, candles, configuration).trades;
}

export function simulateTradesWithSkips(signals: readonly Signal[], candles: readonly Candle[], configuration: SimulationConfiguration): Readonly<{ trades: readonly SimulatedTrade[]; skipped: readonly SkippedSignal[] }> {
  const trades: SimulatedTrade[] = [];
  const skipped: SkippedSignal[] = [];
  let previousExit = -1;
  const indexByTimestamp = new Map(candles.map((candle, index) => [candle.timestamp, index]));
  for (const signal of signals) {
    const intendedEntry = signal.candleIndex + (configuration.entryTiming === 'NEXT_OPEN' ? 1 : 0);
    const skip = (reason: SkippedSignal['reason']) => skipped.push(Object.freeze({ timestamp: signal.timestamp, candleIndex: signal.candleIndex, matchedRules: signal.matchedRules, missingRules: signal.missingRules, blockedRules: signal.blockedRules, reason, evaluations: signal.evaluations }));
    if (!configuration.allowOverlappingTrades && intendedEntry <= previousExit) { skip('OVERLAPPING_TRADE'); continue; }
    const trade = simulateTrade(signal, candles, configuration);
    if (!trade) { skip('NO_NEXT_CANDLE'); continue; }
    trades.push(trade);
    previousExit = indexByTimestamp.get(trade.exitTimestamp) ?? intendedEntry;
  }
  return Object.freeze({ trades: Object.freeze(trades), skipped: Object.freeze(skipped) });
}
