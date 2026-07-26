import { atr, ema, sma } from './indicators.ts';
import type { Candle, ExecutableRule, ExecutableStrategy, PriceDistanceRule, RuleEvaluation, Signal, TradeDirection } from './types.ts';

const compare = (left: number, right: number, relation: 'ABOVE' | 'BELOW') => relation === 'ABOVE' ? left > right : left < right;

function evaluateRule(rule: ExecutableRule, candles: readonly Candle[], strategy: ExecutableStrategy): RuleEvaluation {
  const current = candles.at(-1)!;
  let passed = false;
  let reason = '';
  switch (rule.type) {
    case 'EMA_RELATION': {
      const fast = ema(candles, rule.fastPeriod), slow = ema(candles, rule.slowPeriod);
      passed = fast !== null && slow !== null && compare(fast, slow, rule.relation);
      reason = fast === null || slow === null ? 'Insufficient EMA history.' : `EMA(${rule.fastPeriod})=${fast} ${rule.relation} EMA(${rule.slowPeriod})=${slow}.`;
      break;
    }
    case 'CLOSE_VS_EMA': {
      const value = ema(candles, rule.period);
      passed = value !== null && compare(current.close, value, rule.relation);
      reason = value === null ? 'Insufficient EMA history.' : `Close ${current.close} ${rule.relation} EMA(${rule.period})=${value}.`;
      break;
    }
    case 'PRICE_CROSS_LEVEL': {
      const previous = candles.at(-2);
      passed = Boolean(previous && (rule.direction === 'ABOVE' ? previous.close <= rule.level && current.close > rule.level : previous.close >= rule.level && current.close < rule.level));
      reason = `Close ${passed ? 'crossed' : 'did not cross'} ${rule.direction.toLowerCase()} ${rule.level}.`;
      break;
    }
    case 'BREAKOUT': {
      const previous = candles.slice(-rule.lookback - 1, -1);
      const level = rule.direction === 'ABOVE' ? Math.max(...previous.map((candle) => candle.high)) : Math.min(...previous.map((candle) => candle.low));
      passed = previous.length === rule.lookback && compare(current.close, level, rule.direction);
      reason = previous.length < rule.lookback ? 'Insufficient breakout history.' : `Close ${current.close} ${rule.direction} prior ${rule.lookback}-bar level ${level}.`;
      break;
    }
    case 'PULLBACK_AFTER_BREAKOUT': {
      passed = false;
      for (let ago = 1; ago <= rule.maximumBarsSinceBreakout && candles.length > rule.lookback + ago; ago += 1) {
        const breakoutIndex = candles.length - 1 - ago;
        const breakout = candles[breakoutIndex]!;
        const reference = candles.slice(breakoutIndex - rule.lookback, breakoutIndex);
        const level = rule.direction === 'ABOVE' ? Math.max(...reference.map((candle) => candle.high)) : Math.min(...reference.map((candle) => candle.low));
        const broke = compare(breakout.close, level, rule.direction);
        const retested = rule.direction === 'ABOVE' ? current.low <= level && current.close >= level : current.high >= level && current.close <= level;
        if (broke && retested) { passed = true; break; }
      }
      reason = passed ? 'A prior close breakout was followed by a level retest.' : 'No qualifying breakout/retest sequence exists in the configured window.';
      break;
    }
    case 'CANDLE_DIRECTION':
      passed = rule.direction === 'BULLISH' ? current.close > current.open : current.close < current.open;
      reason = `Candle is ${current.close > current.open ? 'bullish' : current.close < current.open ? 'bearish' : 'neutral'}.`;
      break;
    case 'MIN_BODY_TO_RANGE': {
      const range = current.high - current.low;
      const ratio = range > 0 ? Math.abs(current.close - current.open) / range : 0;
      passed = ratio >= rule.minimumRatio;
      reason = `Body/range=${ratio}; minimum=${rule.minimumRatio}.`;
      break;
    }
    case 'VOLUME_VS_SMA': {
      const values = candles.flatMap((candle) => candle.volume === undefined ? [] : [candle.volume]);
      const average = sma(values.slice(0, -1), rule.period);
      passed = current.volume !== undefined && average !== null && current.volume > average * rule.multiplier;
      reason = current.volume === undefined ? 'Volume is unavailable.' : average === null ? 'Insufficient volume history.' : `Volume=${current.volume}; threshold=${average * rule.multiplier}.`;
      break;
    }
    case 'ATR_THRESHOLD': {
      const value = atr(candles, rule.period);
      passed = value !== null && compare(value, rule.threshold, rule.relation);
      reason = value === null ? 'Insufficient ATR history.' : `ATR(${rule.period})=${value} ${rule.relation} ${rule.threshold}.`;
      break;
    }
    case 'SESSION': {
      const date = new Date(current.timestamp), minute = date.getUTCHours() * 60 + date.getUTCMinutes();
      passed = rule.startUtcMinute <= rule.endUtcMinute ? minute >= rule.startUtcMinute && minute < rule.endUtcMinute : minute >= rule.startUtcMinute || minute < rule.endUtcMinute;
      reason = `UTC minute ${minute} is ${passed ? 'inside' : 'outside'} the configured session.`;
      break;
    }
    case 'DAY_OF_WEEK': {
      const day = new Date(current.timestamp).getUTCDay();
      passed = rule.allowedDaysUtc.includes(day);
      reason = `UTC weekday=${day}.`;
      break;
    }
    case 'MINIMUM_RR': {
      const stop = distance(strategy.stopLossRule, candles), target = distance(strategy.takeProfitRule, candles);
      const rr = stop === null || stop <= 0 || target === null ? null : target / stop;
      passed = rr !== null && rr >= rule.minimum;
      reason = rr === null ? 'Risk/reward is unavailable.' : `Configured risk/reward=${rr}; minimum=${rule.minimum}.`;
      break;
    }
  }
  return Object.freeze({ ruleId: rule.id, type: rule.type, passed, reason });
}

function distance(rule: PriceDistanceRule, candles: readonly Candle[]): number | null {
  const close = candles.at(-1)!.close;
  if (rule.type === 'FIXED_PRICE') return rule.distance;
  if (rule.type === 'PERCENT') return close * rule.percent / 100;
  const value = atr(candles, rule.period);
  return value === null ? null : value * rule.multiple;
}

function signalDirection(strategy: ExecutableStrategy, candle: Candle): TradeDirection {
  if (strategy.direction === 'LONG') return 'LONG';
  if (strategy.direction === 'SHORT') return 'SHORT';
  return candle.close >= candle.open ? 'LONG' : 'SHORT';
}

export function evaluateSignal(strategy: ExecutableStrategy, candlesAvailableAtTimestamp: readonly Candle[], candleIndex: number): Signal | null {
  if (!candlesAvailableAtTimestamp.length) return null;
  const current = candlesAvailableAtTimestamp.at(-1)!;
  const extraFilters = [strategy.sessionFilter, strategy.volatilityFilter].filter((rule): rule is NonNullable<typeof rule> => rule !== undefined);
  const entryRules = [...strategy.entryRules, ...extraFilters.filter((filter) => !strategy.entryRules.some((rule) => rule.id === filter.id))];
  const evaluations = entryRules.map((rule) => evaluateRule(rule, candlesAvailableAtTimestamp, strategy));
  const forbidden = strategy.forbiddenRules.map((rule) => evaluateRule(rule, candlesAvailableAtTimestamp, strategy));
  const required = entryRules.filter((rule) => rule.required !== false);
  const passedRequired = required.filter((rule) => evaluations.find((result) => result.ruleId === rule.id)?.passed).length;
  const blockedRules = forbidden.filter((result) => result.passed).map((result) => result.ruleId);
  if (passedRequired < Math.min(strategy.minimumRequiredConfirmations, required.length) || blockedRules.length) return null;
  const stopDistance = distance(strategy.stopLossRule, candlesAvailableAtTimestamp);
  const targetDistance = distance(strategy.takeProfitRule, candlesAvailableAtTimestamp);
  if (stopDistance === null || targetDistance === null || stopDistance <= 0 || targetDistance <= 0) return null;
  const direction = signalDirection(strategy, current);
  return Object.freeze({
    timestamp: current.timestamp, candleIndex, direction, entryPrice: current.close,
    stopPrice: direction === 'LONG' ? current.close - stopDistance : current.close + stopDistance,
    targetPrice: direction === 'LONG' ? current.close + targetDistance : current.close - targetDistance,
    matchedRules: Object.freeze(evaluations.filter((result) => result.passed).map((result) => result.ruleId)),
    missingRules: Object.freeze(evaluations.filter((result) => !result.passed).map((result) => result.ruleId)),
    blockedRules: Object.freeze(blockedRules),
    evaluations: Object.freeze([...evaluations, ...forbidden]),
  });
}

export function findSignals(strategy: ExecutableStrategy, candles: readonly Candle[]): readonly Signal[] {
  const signals: Signal[] = [];
  for (let index = 0; index < candles.length; index += 1) {
    const signal = evaluateSignal(strategy, candles.slice(0, index + 1), index);
    if (signal) signals.push(signal);
  }
  return Object.freeze(signals);
}
