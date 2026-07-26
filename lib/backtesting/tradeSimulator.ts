import type { Candle, Signal, SimulatedTrade, SimulationConfiguration, TradeDirection } from './types.ts';

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
  const rawEntry = configuration.entryTiming === 'NEXT_OPEN' ? entryCandle.open : signal.entryPrice;
  const entryCost = configuration.costs.spreadPrice / 2 + configuration.costs.slippagePrice;
  const entryPrice = signal.direction === 'LONG' ? rawEntry + entryCost : rawEntry - entryCost;
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
  const grossR = favorable(signal.direction, exitPrice, entryPrice) / stopDistance;
  const pnlR = grossR - configuration.costs.commissionR;
  const outcome = pnlR > 0 ? 'WIN' : pnlR < 0 ? 'LOSS' : 'BREAK_EVEN';
  return Object.freeze({ signalTimestamp: signal.timestamp, entryTimestamp: entryCandle.timestamp, exitTimestamp: candles[exitIndex]!.timestamp, direction: signal.direction, entryPrice, stopPrice, targetPrice, exitPrice, outcome, pnlR, maximumFavorableExcursionR: maximumFavorable / stopDistance, maximumAdverseExcursionR: maximumAdverse / stopDistance, barsHeld: exitIndex - entryIndex + 1, exitReason });
}
export function simulateTrades(signals: readonly Signal[], candles: readonly Candle[], configuration: SimulationConfiguration): readonly SimulatedTrade[] {
  const trades: SimulatedTrade[] = [];
  let previousExit = -1;
  const indexByTimestamp = new Map(candles.map((candle, index) => [candle.timestamp, index]));
  for (const signal of signals) {
    const intendedEntry = signal.candleIndex + (configuration.entryTiming === 'NEXT_OPEN' ? 1 : 0);
    if (!configuration.allowOverlappingTrades && intendedEntry <= previousExit) continue;
    const trade = simulateTrade(signal, candles, configuration);
    if (!trade) continue;
    trades.push(trade);
    previousExit = indexByTimestamp.get(trade.exitTimestamp) ?? intendedEntry;
  }
  return Object.freeze(trades);
}
