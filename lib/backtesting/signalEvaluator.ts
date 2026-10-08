import { atr, ema, sma } from './indicators.ts';
import type { Candle, ExecutableRule, ExecutableStrategy, PriceDistanceRule, RuleEvaluation, Signal, SkippedSignal, TradeDirection } from './types.ts';

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
    case 'SMA_RELATION': {
      const fast = sma(candles.map((candle) => candle.close), rule.fastPeriod), slow = sma(candles.map((candle) => candle.close), rule.slowPeriod);
      passed = fast !== null && slow !== null && compare(fast, slow, rule.relation) && (!rule.closeMustConfirmSlow || compare(current.close, slow, rule.relation));
      reason = fast === null || slow === null ? 'Insufficient SMA history.' : `SMA(${rule.fastPeriod})=${fast} ${rule.relation} SMA(${rule.slowPeriod})=${slow}; close confirmation=${rule.closeMustConfirmSlow}.`;
      break;
    }
    case 'CLOSE_VS_EMA': {
      const value = ema(candles, rule.period);
      passed = value !== null && compare(current.close, value, rule.relation);
      reason = value === null ? 'Insufficient EMA history.' : `Close ${current.close} ${rule.relation} EMA(${rule.period})=${value}.`;
      break;
    }
    case 'CLOSE_VS_SMA': {
      const value = sma(candles.map((candle) => candle.close), rule.period);
      passed = value !== null && compare(current.close, value, rule.relation);
      reason = value === null ? 'Insufficient SMA history.' : `Close ${current.close} ${rule.relation} SMA(${rule.period})=${value}.`;
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
    case 'LEGACY_RETEST': {
      const fast = sma(candles.map((candle) => candle.close), rule.trendFastPeriod), slow = sma(candles.map((candle) => candle.close), rule.trendSlowPeriod), value = atr(candles, rule.atrPeriod);
      const recent = candles.slice(-rule.lookback - 1, -1);
      if (fast === null || slow === null || value === null || recent.length < rule.lookback) {
        passed = false; reason = 'Insufficient legacy retest history.';
      } else {
        const bullish = fast > slow && current.close > slow, target = bullish ? Math.max(...recent.map((candle) => candle.high)) : Math.min(...recent.map((candle) => candle.low));
        const tolerance = Math.max(value * rule.toleranceAtrMultiple, current.close * rule.tolerancePriceMultiple);
        passed = Math.abs(current.close - target) <= tolerance;
        reason = `Distance=${Math.abs(current.close - target)}; tolerance=${tolerance}; target=${target}.`;
      }
      break;
    }
    case 'LEGACY_DISPLACEMENT': {
      const value = atr(candles, rule.atrPeriod), body = Math.abs(current.close - current.open), range = Math.max(current.high - current.low, Number.EPSILON);
      passed = value !== null && body > Math.max(value * rule.atrMultiple, range * rule.bodyRangeRatio);
      reason = value === null ? 'Insufficient displacement ATR history.' : `Body=${body}; threshold=${Math.max(value * rule.atrMultiple, range * rule.bodyRangeRatio)}.`;
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

export type SignalEvaluationOutcome = Readonly<{ signal: Signal | null; skipped: SkippedSignal | null }>;
export function evaluateSignalOutcome(strategy: ExecutableStrategy, candlesAvailableAtTimestamp: readonly Candle[], candleIndex: number): SignalEvaluationOutcome {
  if (!candlesAvailableAtTimestamp.length) return Object.freeze({ signal: null, skipped: null });
  const current = candlesAvailableAtTimestamp.at(-1)!;
  const extraFilters = [strategy.sessionFilter, strategy.volatilityFilter].filter((rule): rule is NonNullable<typeof rule> => rule !== undefined);
  const entryRules = [...strategy.entryRules, ...extraFilters.filter((filter) => !strategy.entryRules.some((rule) => rule.id === filter.id))];
  const evaluations = entryRules.map((rule) => evaluateRule(rule, candlesAvailableAtTimestamp, strategy));
  const forbidden = strategy.forbiddenRules.map((rule) => evaluateRule(rule, candlesAvailableAtTimestamp, strategy));
  const required = entryRules.filter((rule) => rule.required !== false);
  const passedRequired = required.filter((rule) => evaluations.find((result) => result.ruleId === rule.id)?.passed).length;
  const blockedRules = forbidden.filter((result) => result.passed).map((result) => result.ruleId);
  const matchedRules = evaluations.filter((result) => result.passed).map((result) => result.ruleId), missingRules = evaluations.filter((result) => !result.passed).map((result) => result.ruleId);
  const skipped = (reason: SkippedSignal['reason']): SignalEvaluationOutcome => Object.freeze({ signal: null, skipped: Object.freeze({ timestamp: current.timestamp, candleIndex, matchedRules: Object.freeze(matchedRules), missingRules: Object.freeze(missingRules), blockedRules: Object.freeze(blockedRules), reason, evaluations: Object.freeze([...evaluations, ...forbidden]) }) });
  if (blockedRules.length) return skipped('FORBIDDEN_RULE');
  if (passedRequired < required.length || matchedRules.length < strategy.minimumRequiredConfirmations) return skipped('INSUFFICIENT_CONFIRMATIONS');
  const stopDistance = distance(strategy.stopLossRule, candlesAvailableAtTimestamp);
  const targetDistance = distance(strategy.takeProfitRule, candlesAvailableAtTimestamp);
  if (stopDistance === null || targetDistance === null || stopDistance <= 0 || targetDistance <= 0) return skipped('UNAVAILABLE_RISK_LEVELS');
  const direction = signalDirection(strategy, current);
  const signal: Signal = Object.freeze({
    timestamp: current.timestamp, candleIndex, direction, entryPrice: current.close,
    stopPrice: direction === 'LONG' ? current.close - stopDistance : current.close + stopDistance,
    targetPrice: direction === 'LONG' ? current.close + targetDistance : current.close - targetDistance,
    matchedRules: Object.freeze(matchedRules),
    missingRules: Object.freeze(missingRules),
    blockedRules: Object.freeze(blockedRules),
    evaluations: Object.freeze([...evaluations, ...forbidden]),
  });
  return Object.freeze({ signal, skipped: null });
}

export function evaluateSignal(strategy: ExecutableStrategy, candlesAvailableAtTimestamp: readonly Candle[], candleIndex: number): Signal | null {
  return evaluateSignalOutcome(strategy, candlesAvailableAtTimestamp, candleIndex).signal;
}

export function findSignals(strategy: ExecutableStrategy, candles: readonly Candle[]): readonly Signal[] {
  return findSignalEvaluations(strategy, candles).signals;
}

export function findSignalEvaluations(strategy: ExecutableStrategy, candles: readonly Candle[]): Readonly<{ signals: readonly Signal[]; skipped: readonly SkippedSignal[] }> {
  const signals: Signal[] = [];
  const skipped: SkippedSignal[] = [];
  for (let index = 0; index < candles.length; index += 1) {
    const outcome = evaluateSignalOutcome(strategy, candles.slice(0, index + 1), index);
    if (outcome.signal) signals.push(outcome.signal);
    if (outcome.skipped) skipped.push(outcome.skipped);
  }
  return Object.freeze({ signals: Object.freeze(signals), skipped: Object.freeze(skipped) });
}
