import type { StopLimit, StrategyProfile } from '../../types/trade.ts';
import { meetsMinimumRiskReward, normalizedRiskReward } from '../trade-risk.ts';

function valueInPrice(instrument: string, entry: number, limit: StopLimit, value: number): number {
  if (limit.method === 'PIPS') return value * (instrument.endsWith('JPY') ? 0.01 : 0.0001);
  if (limit.method === 'POINTS') return value * (instrument.startsWith('XAU') || instrument.startsWith('XAG') ? 0.01 : 1);
  if (limit.method === 'TICKS') return value * 0.25;
  if (limit.method === 'PERCENT') return Math.abs(entry) * value / 100;
  return Number.NaN;
}

export type BacktestRiskGeometryResult = Readonly<{
  passed: boolean;
  reason: 'VALID' | 'NON_POSITIVE_GEOMETRY' | 'STOP_BELOW_MINIMUM' | 'STOP_ABOVE_MAXIMUM' | 'RR_BELOW_MINIMUM';
  stopDistance: number;
  rr: number;
  minimumStop: number | null;
  maximumStop: number | null;
}>;

export function evaluateBacktestRiskGeometry(
  strategy: StrategyProfile,
  instrument: string,
  entry: number,
  stopLoss: number,
  takeProfit: number,
): BacktestRiskGeometryResult {
  const stopDistance = Math.abs(entry - stopLoss);
  const rewardDistance = Math.abs(takeProfit - entry);
  const configured = strategy.stopLimitSettings?.find((limit) => limit.instrument === instrument);
  const minimumStop = configured && Number(configured.minimumValue ?? 0) > 0
    ? valueInPrice(instrument, entry, configured, Number(configured.minimumValue))
    : null;
  const maximumStop = configured
    ? valueInPrice(instrument, entry, configured, Number(configured.maximumValue))
    : Number.isFinite(Number(strategy.stopLimits?.[instrument])) ? Number(strategy.stopLimits[instrument]) : null;
  const rr = normalizedRiskReward(entry, stopLoss, takeProfit);
  if (!(stopDistance > 0) || !(rewardDistance > 0)) return { passed:false, reason:'NON_POSITIVE_GEOMETRY', stopDistance, rr, minimumStop, maximumStop };
  if (minimumStop != null && Number.isFinite(minimumStop) && stopDistance < minimumStop) return { passed:false, reason:'STOP_BELOW_MINIMUM', stopDistance, rr, minimumStop, maximumStop };
  if (maximumStop != null && Number.isFinite(maximumStop) && stopDistance > maximumStop) return { passed:false, reason:'STOP_ABOVE_MAXIMUM', stopDistance, rr, minimumStop, maximumStop };
  if (!meetsMinimumRiskReward(rr, Number(strategy.minimumRR))) return { passed:false, reason:'RR_BELOW_MINIMUM', stopDistance, rr, minimumStop, maximumStop };
  return { passed:true, reason:'VALID', stopDistance, rr, minimumStop, maximumStop };
}
