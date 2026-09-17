import type { Candle } from '../market-analysis.ts';
import type { NormalizedCandle } from '../market-intelligence/contracts.ts';
import { detectConfirmedSwings } from '../market-intelligence/detectors/confirmed-swing/confirmed-swing-utils.ts';
import { evaluateOrderBlocks } from '../market-intelligence/detectors/order-block-detector.ts';
import { detectFairValueGapLifecycles } from '../market-intelligence/imbalance/fair-value-gap/fair-value-gap-lifecycle-detector.ts';
import { detectStructuralLiquiditySweeps } from '../market-intelligence/liquidity/structural-sweep/structural-liquidity-sweep-detector.ts';
import { detectBreaksOfStructure } from '../market-intelligence/structure/break-of-structure/break-of-structure-detector.ts';
import { classifyMarketStructureTransitions } from '../market-intelligence/structure/market-structure-shift/market-structure-shift-classifier.ts';
import { reduceMarketStructure } from '../market-intelligence/structure/structure-reducer.ts';
import type { CanonicalHistoricalRule, HistoricalRulePlan } from './historical-rule-plan.ts';
import { HISTORICAL_TIMEFRAMES } from './historical-timeframes.ts';
import type { StructureReducerConfig } from '../market-intelligence/structure/structure-types.ts';
import type { BreakOfStructureConfig } from '../market-intelligence/structure/break-of-structure/break-of-structure-types.ts';
import type { MarketStructureShiftConfig } from '../market-intelligence/structure/market-structure-shift/market-structure-shift-types.ts';
import type { StructuralLiquiditySweepConfig } from '../market-intelligence/liquidity/structural-sweep/structural-liquidity-sweep-types.ts';


export type HistoricalRuleEvaluation = Readonly<{
  ruleId: string;
  detectorId: CanonicalHistoricalRule['detectorId'];
  passed: boolean;
  status: 'MATCHED' | 'NOT_MATCHED' | 'INSUFFICIENT_DATA';
  evidence: readonly Record<string, unknown>[];
  metadata: Readonly<Record<string, unknown>>;
}>;

export type HistoricalRuleEvaluationResult = Readonly<{ passed: boolean; evaluations: readonly HistoricalRuleEvaluation[] }>;

const numberParameter = (rule: CanonicalHistoricalRule, name: string, fallback = 0) => {
  const value = Number(rule.parameters[name]);
  return Number.isFinite(value) ? value : fallback;
};

function normalized(candles: readonly Candle[], timeframe: string): NormalizedCandle[] {
  const duration = HISTORICAL_TIMEFRAMES[timeframe as keyof typeof HISTORICAL_TIMEFRAMES]?.minutes * 60_000;
  if (!duration) return [];
  return candles.map((candle) => ({
    openedAt: candle.datetime,
    closedAt: new Date(Date.parse(candle.datetime) + duration).toISOString(),
    open: candle.open, high: candle.high, low: candle.low, close: candle.close,
    volume: candle.volume ?? null, complete: true,
  }));
}

function directionMatches(expected: CanonicalHistoricalRule['direction'], actual: string): boolean {
  return expected === 'BOTH' || expected === actual;
}

function result(rule: CanonicalHistoricalRule, passed: boolean, evidence: readonly Record<string, unknown>[], metadata: Record<string, unknown>, insufficient = false): HistoricalRuleEvaluation {
  return Object.freeze({ ruleId: rule.id, detectorId: rule.detectorId, passed, status: insufficient ? 'INSUFFICIENT_DATA' : passed ? 'MATCHED' : 'NOT_MATCHED', evidence: Object.freeze([...evidence]), metadata: Object.freeze(metadata) });
}

function eventOperatorPasses(rule: CanonicalHistoricalRule, detected: boolean): boolean {
  if (rule.operator === 'EVENT_CONFIRMED') return detected;
  if (rule.operator === 'EVENT_NOT_CONFIRMED') return !detected;
  throw new Error(`Historical operator ${rule.operator} is invalid for event detector ${rule.detectorId}.`);
}

function lifecycleOperatorPasses(rule: CanonicalHistoricalRule, active: boolean, newlyConfirmed: boolean): boolean {
  if (rule.operator === 'ACTIVE_EXISTS') return active;
  if (rule.operator === 'ACTIVE_MISSING') return !active;
  if (rule.operator === 'NEWLY_CONFIRMED') return newlyConfirmed;
  throw new Error(`Historical operator ${rule.operator} is invalid for lifecycle detector ${rule.detectorId}.`);
}

function operands(rule: CanonicalHistoricalRule): number[] {
  const raw = Array.isArray(rule.parameters.operands) ? rule.parameters.operands : [];
  return raw.map(Number).filter(Number.isFinite);
}

function valueOperatorPasses(rule: CanonicalHistoricalRule, current: number, previous = current): boolean {
  const expected = operands(rule);
  const threshold = expected[0] ?? numberParameter(rule, 'threshold');
  if (rule.operator === 'GREATER_THAN') return current > threshold;
  if (rule.operator === 'LESS_THAN') return current < threshold;
  if (rule.operator === 'GREATER_THAN_OR_EQUAL') return current >= threshold;
  if (rule.operator === 'LESS_THAN_OR_EQUAL') return current <= threshold;
  if (rule.operator === 'CROSSES_ABOVE') return previous <= threshold && current > threshold;
  if (rule.operator === 'CROSSES_BELOW') return previous >= threshold && current < threshold;
  if (rule.operator === 'BETWEEN') return current >= Math.min(threshold, expected[1] ?? threshold) && current <= Math.max(threshold, expected[1] ?? threshold);
  if (rule.operator === 'OUTSIDE') return current < Math.min(threshold, expected[1] ?? threshold) || current > Math.max(threshold, expected[1] ?? threshold);
  throw new Error(`Historical operator ${rule.operator} is invalid for value detector ${rule.detectorId}.`);
}

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

const conceptId = (rule: CanonicalHistoricalRule) => String(rule.parameters.ruleId ?? rule.parameters.concept ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function ema(values: readonly number[], period: number): number[] {
  if (!values.length) return [];
  const multiplier = 2 / (Math.max(1, period) + 1);
  const output = [values[0]!];
  for (let index = 1; index < values.length; index += 1) output.push(values[index]! * multiplier + output[index - 1]! * (1 - multiplier));
  return output;
}

function rsi(values: readonly number[], period: number): number[] {
  const output = Array(values.length).fill(Number.NaN) as number[];
  if (values.length <= period) return output;
  for (let index = period; index < values.length; index += 1) {
    let gains = 0, losses = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      const change = values[cursor]! - values[cursor - 1]!;
      if (change >= 0) gains += change; else losses -= change;
    }
    output[index] = losses === 0 ? 100 : 100 - (100 / (1 + gains / losses));
  }
  return output;
}

function technical(rule: CanonicalHistoricalRule, candles: NormalizedCandle[]): HistoricalRuleEvaluation {
  const id = conceptId(rule);
  const period = Math.max(1, numberParameter(rule, 'period', 14));
  const closes = candles.map((candle) => candle.close);
  if (candles.length < Math.max(period + 2, 5)) return result(rule, false, [], { period, ruleId: id }, true);
  let values: number[] = [];
  if (id === 'trend-ema' || id === 'ema') values = ema(closes, period);
  else if (id === 'trend-sma' || id === 'sma') values = closes.map((_, index) => index + 1 < period ? Number.NaN : average(closes.slice(index + 1 - period, index + 1)));
  else if (id === 'trend-vwap' || id === 'vwap') {
    const volume = candles.map((candle) => candle.volume);
    if (volume.some((value) => value == null)) return result(rule, false, [], { ruleId: id, dataRequirement: 'volume' }, true);
    let cumulativePriceVolume = 0, cumulativeVolume = 0;
    values = candles.map((candle) => {
      cumulativePriceVolume += ((candle.high + candle.low + candle.close) / 3) * Number(candle.volume);
      cumulativeVolume += Number(candle.volume);
      return cumulativeVolume ? cumulativePriceVolume / cumulativeVolume : candle.close;
    });
  } else if (id === 'momentum-rsi' || id === 'rsi') values = rsi(closes, period);
  else if (id === 'momentum-macd' || id === 'macd') {
    const fast = ema(closes, 12), slow = ema(closes, 26);
    const line = fast.map((value, index) => value - slow[index]!);
    const signal = ema(line, 9);
    values = line.map((value, index) => value - signal[index]!);
  } else if (id === 'momentum-stochastic' || id === 'stochastic') {
    values = candles.map((candle, index) => {
      const window = candles.slice(Math.max(0, index + 1 - period), index + 1);
      const high = Math.max(...window.map((item) => item.high)), low = Math.min(...window.map((item) => item.low));
      return high === low ? 50 : (candle.close - low) / (high - low) * 100;
    });
  } else if (id === 'momentum-cci' || id === 'cci') {
    const typical = candles.map((candle) => (candle.high + candle.low + candle.close) / 3);
    values = typical.map((value, index) => {
      const window = typical.slice(Math.max(0, index + 1 - period), index + 1), mean = average(window), deviation = average(window.map((item) => Math.abs(item - mean)));
      return deviation ? (value - mean) / (0.015 * deviation) : 0;
    });
  } else if (id === 'momentum-adx' || id === 'adx') {
    values = candles.map((candle, index) => {
      const window = candles.slice(Math.max(1, index + 1 - period), index + 1);
      const directional = window.map((item, itemIndex) => {
        const previous = candles[Math.max(0, index + 1 - window.length + itemIndex - 1)]!;
        const tr = Math.max(item.high - item.low, Math.abs(item.high - previous.close), Math.abs(item.low - previous.close));
        return tr ? Math.abs((item.high - previous.high) - (previous.low - item.low)) / tr * 100 : 0;
      });
      return average(directional);
    });
  } else if (id === 'trend-supertrend' || id === 'supertrend') {
    const baseline = ema(closes, period).at(-1)!;
    const atr = average(candles.slice(-period).map((candle, index, window) => {
      const previousClose = index ? window[index - 1]!.close : candle.open;
      return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
    }));
    const multiplier = numberParameter(rule, 'multiplier', 3);
    const bullish = closes.at(-1)! > baseline + atr * multiplier, bearish = closes.at(-1)! < baseline - atr * multiplier;
    const detected = (bullish || bearish) && directionMatches(rule.direction, bullish ? 'BULLISH' : 'BEARISH');
    const passed = eventOperatorPasses(rule, detected);
    return result(rule, passed, passed ? [{ baseline, atr, multiplier, bullish, bearish }] : [], { ruleId: id, period });
  } else {
    const periods = String(rule.parameters.periods ?? '8,13,21,55').split(/[^0-9]+/).map(Number).filter((value) => value > 0);
    const averages = periods.map((value) => ema(closes, value).at(-1)!);
    const bullish = averages.every((value, index) => index === 0 || averages[index - 1]! > value);
    const bearish = averages.every((value, index) => index === 0 || averages[index - 1]! < value);
    const detected = directionMatches(rule.direction, bullish ? 'BULLISH' : bearish ? 'BEARISH' : 'RANGE');
    const passed = eventOperatorPasses(rule, detected && (bullish || bearish));
    return result(rule, passed, passed ? [{ bullish, bearish, averages }] : [], { ruleId: id, periods });
  }
  const current = values.at(-1)!, previous = values.at(-2)!;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return result(rule, false, [], { period, ruleId: id }, true);
  const passed = ['EVENT_CONFIRMED', 'EVENT_NOT_CONFIRMED'].includes(rule.operator)
    ? eventOperatorPasses(rule, directionMatches(rule.direction, current >= previous ? 'BULLISH' : 'BEARISH'))
    : valueOperatorPasses(rule, current, previous);
  return result(rule, passed, passed ? [{ value: current, previous }] : [], { ruleId: id, period, value: current, previous });
}

function structureStateOrLevel(rule: CanonicalHistoricalRule, candles: NormalizedCandle[]): HistoricalRuleEvaluation {
  const id = conceptId(rule), concept = String(rule.parameters.concept).toLowerCase();
  const leftBars = numberParameter(rule, 'leftBars', 2), rightBars = numberParameter(rule, 'rightBars', 2);
  if (candles.length < leftBars + rightBars + 3) return result(rule, false, [], { ruleId: id }, true);
  const swings = detectConfirmedSwings(candles, { leftBars, rightBars, equalityPolicy: 'STRICT', context: { timeframe: rule.timeframe } }).swings;
  const latest = candles.at(-1)!;
  if (rule.detectorId === 'market-structure.level') {
    const highs = swings.filter((swing) => swing.direction === 'HIGH'), lows = swings.filter((swing) => swing.direction === 'LOW');
    const support = lows.at(-1)?.price, resistance = highs.at(-1)?.price;
    const tolerance = numberParameter(rule, 'tolerance', Math.max(latest.high - latest.low, latest.close * 0.0005));
    const wantsSupport = id.includes('support') || concept.includes('support');
    const wantsResistance = id.includes('resistance') || concept.includes('resistance');
    const pivot = (candles.at(-2)!.high + candles.at(-2)!.low + candles.at(-2)!.close) / 3;
    const level = wantsSupport ? support : wantsResistance ? resistance : pivot;
    const detected = level !== undefined && latest.low <= level + tolerance && latest.high >= level - tolerance;
    const passed = eventOperatorPasses(rule, detected);
    return result(rule, passed, passed ? [{ level, candle: latest.closedAt, type: wantsSupport ? 'SUPPORT' : wantsResistance ? 'RESISTANCE' : 'PIVOT' }] : [], { ruleId: id, tolerance, confirmedAtOrBefore: latest.closedAt });
  }
  const snapshots = reduceMarketStructure(swings, {}).snapshots;
  const latestSnapshot = snapshots.at(-1);
  const wanted = id.replace(/^structure-/, '') || tokenConcept(concept);
  const wantedLabel: Record<string, string> = { 'higher-high': 'HH', 'higher-low': 'HL', 'lower-high': 'LH', 'lower-low': 'LL' };
  const snapshotLabels = [latestSnapshot?.latestHighLabel, latestSnapshot?.latestLowLabel].filter(Boolean);
  const label = wantedLabel[wanted] ?? '';
  const detected = wanted === 'mss'
    ? snapshots.length >= 2 && String((snapshots.at(-2) as unknown as { bias?: string })?.bias) !== String((latestSnapshot as unknown as { bias?: string })?.bias)
    : snapshotLabels.includes(label as never);
  const passed = eventOperatorPasses(rule, detected);
  return result(rule, passed, passed && latestSnapshot ? [latestSnapshot as unknown as Record<string, unknown>] : [], { ruleId: id, latestLabels: snapshotLabels });
}

function tokenConcept(value: string) { return value.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function pattern(rule: CanonicalHistoricalRule, candles: NormalizedCandle[]): HistoricalRuleEvaluation {
  if (candles.length < 2) return result(rule, false, [], {}, true);
  const id = conceptId(rule), current = candles.at(-1)!, previous = candles.at(-2)!;
  const body = Math.abs(current.close - current.open), rangeSize = Math.max(Number.EPSILON, current.high - current.low);
  const bullish = current.close > current.open, bearish = current.close < current.open;
  let detected = false;
  if (id.includes('engulfing')) detected = (bullish && previous.close < previous.open && current.open <= previous.close && current.close >= previous.open) || (bearish && previous.close > previous.open && current.open >= previous.close && current.close <= previous.open);
  else if (id.includes('inside-bar')) detected = current.high < previous.high && current.low > previous.low;
  else if (id.includes('outside-bar')) detected = current.high > previous.high && current.low < previous.low;
  else if (id.includes('pin-bar')) detected = Math.max(current.high - Math.max(current.open, current.close), Math.min(current.open, current.close) - current.low) >= body * 2;
  else detected = body / rangeSize >= numberParameter(rule, 'bodyRatio', 0.6) && Math.max(current.high - Math.max(current.open, current.close), Math.min(current.open, current.close) - current.low) >= body;
  detected = detected && directionMatches(rule.direction, bullish ? 'BULLISH' : bearish ? 'BEARISH' : 'RANGE');
  const passed = eventOperatorPasses(rule, detected);
  return result(rule, passed, passed ? [{ candle: current.closedAt, open: current.open, high: current.high, low: current.low, close: current.close }] : [], { ruleId: id, bodyRatio: body / rangeSize });
}

function rangeState(rule: CanonicalHistoricalRule, candles: NormalizedCandle[]): HistoricalRuleEvaluation {
  const lookback = Math.max(3, numberParameter(rule, 'lookback', 20));
  if (candles.length < lookback + 2) return result(rule, false, [], { lookback }, true);
  const id = conceptId(rule), latest = candles.at(-1)!, previous = candles.at(-2)!;
  const reference = candles.slice(-(lookback + 1), -1), high = Math.max(...reference.map((candle) => candle.high)), low = Math.min(...reference.map((candle) => candle.low));
  let bullish = latest.close > high, bearish = latest.close < low;
  let detected = bullish || bearish;
  if (id.includes('retest')) {
    const priorReference = candles.slice(-(lookback + 2), -2), priorHigh = Math.max(...priorReference.map((candle) => candle.high)), priorLow = Math.min(...priorReference.map((candle) => candle.low));
    bullish = previous.close > priorHigh && latest.low <= priorHigh && latest.close > priorHigh;
    bearish = previous.close < priorLow && latest.high >= priorLow && latest.close < priorLow;
    detected = bullish || bearish;
  } else if (id.includes('consolidation')) {
    const ranges = reference.map((candle) => candle.high - candle.low), recent = high - low;
    detected = recent <= average(ranges) * Math.sqrt(lookback);
  }
  detected = detected && (id.includes('consolidation') || directionMatches(rule.direction, bullish ? 'BULLISH' : 'BEARISH'));
  const passed = eventOperatorPasses(rule, detected);
  return result(rule, passed, passed ? [{ referenceHigh: high, referenceLow: low, candle: latest.closedAt, bullish, bearish }] : [], { ruleId: id, lookback });
}

function volumeSignal(rule: CanonicalHistoricalRule, candles: NormalizedCandle[]): HistoricalRuleEvaluation {
  const lookback = Math.max(2, numberParameter(rule, 'lookback', 20)), volumes = candles.map((candle) => candle.volume);
  if (candles.length < lookback + 1 || volumes.slice(-lookback - 1).some((value) => value == null)) return result(rule, false, [], { dataRequirement: 'volume', lookback }, true);
  const current = Number(volumes.at(-1)), baseline = average(volumes.slice(-lookback - 1, -1).map(Number));
  const ratio = baseline ? current / baseline : 0, id = conceptId(rule);
  let value = ratio, previous = baseline ? Number(volumes.at(-2)) / average(volumes.slice(-lookback - 2, -2).map(Number)) : 0;
  if (id.includes('delta-confirmation')) value = candles.at(-1)!.close >= candles.at(-1)!.open ? ratio : -ratio;
  if (id.includes('divergence')) value = Math.sign(candles.at(-1)!.close - candles.at(-2)!.close) !== Math.sign(current - Number(volumes.at(-2))) ? 1 : 0;
  const passed = ['EVENT_CONFIRMED', 'EVENT_NOT_CONFIRMED'].includes(rule.operator) ? eventOperatorPasses(rule, value > numberParameter(rule, 'threshold', 1.5)) : valueOperatorPasses(rule, value, previous);
  return result(rule, passed, passed ? [{ volume: current, averageVolume: baseline, value }] : [], { ruleId: id, lookback, proxy: id.includes('delta') ? 'signed candle volume' : undefined });
}

function sessionWindow(rule: CanonicalHistoricalRule, candles: NormalizedCandle[]): HistoricalRuleEvaluation {
  const latest = candles.at(-1);
  if (!latest) return result(rule, false, [], {}, true);
  const id = `${conceptId(rule)} ${String(rule.parameters.window)}`.toLowerCase();
  const hour = new Date(latest.closedAt).getUTCHours() + new Date(latest.closedAt).getUTCMinutes() / 60;
  const within = id.includes('overlap') ? hour >= 13 && hour < 16 : id.includes('new-york') || id.includes('new york') ? hour >= 13 && hour < 22 : id.includes('asia') ? hour >= 0 && hour < 9 : id.includes('kill') ? (hour >= 7 && hour < 10) || (hour >= 13 && hour < 16) : hour >= 7 && hour < 16;
  const passed = rule.operator === 'WITHIN' ? within : !within;
  return result(rule, passed, passed ? [{ candle: latest.closedAt, utcHour: hour }] : [], { ruleId: rule.parameters.ruleId, timezone: 'UTC', window: rule.parameters.window });
}

function riskPolicy(rule: CanonicalHistoricalRule): HistoricalRuleEvaluation {
  const value = numberParameter(rule, 'policyValue', Number.NaN);
  if (!Number.isFinite(value) || value <= 0) return result(rule, false, [], { ruleId: rule.parameters.ruleId }, true);
  const passed = ['EVENT_CONFIRMED', 'EVENT_NOT_CONFIRMED'].includes(rule.operator) ? eventOperatorPasses(rule, value > 0) : valueOperatorPasses(rule, value);
  return result(rule, passed, passed ? [{ configuredValue: value }] : [], { ruleId: rule.parameters.ruleId, enforcement: 'strategy-and-execution-policy' });
}

function smartMoneyZone(rule: CanonicalHistoricalRule, candles: NormalizedCandle[], instrument: string): HistoricalRuleEvaluation {
  if (candles.length < 5) return result(rule, false, [], { ruleId: rule.parameters.ruleId }, true);
  const id = conceptId(rule), latest = candles.at(-1)!;
  if (id.includes('breaker-block') || id.includes('mitigation-block')) {
    const observation = evaluateOrderBlocks(candles, { instrument, timeframe: rule.timeframe, sourceMaxLookback: numberParameter(rule, 'lookback', 20) });
    const candidates = observation.orderBlocks.filter((block) => block.eligible && directionMatches(rule.direction, block.direction));
    const detected = candidates.length > 0;
    const passed = eventOperatorPasses(rule, detected);
    return result(rule, passed, passed ? candidates : [], { ruleId: id, proxy: id.includes('breaker') ? 'eligible order-block break state' : 'eligible order-block mitigation state' });
  }
  const lookback = Math.max(5, numberParameter(rule, 'lookback', 20));
  const window = candles.slice(-lookback), high = Math.max(...window.map((candle) => candle.high)), low = Math.min(...window.map((candle) => candle.low)), midpoint = (high + low) / 2;
  let detected = id.includes('premium') ? latest.close > midpoint : id.includes('discount') ? latest.close < midpoint : false;
  if (id.includes('equal-high')) {
    const sorted = window.map((candle) => candle.high).sort((a, b) => b - a);
    detected = Math.abs(sorted[0]! - sorted[1]!) <= Math.max(latest.close * 0.0005, latest.high - latest.low);
  }
  if (id.includes('equal-low')) {
    const sorted = window.map((candle) => candle.low).sort((a, b) => a - b);
    detected = Math.abs(sorted[0]! - sorted[1]!) <= Math.max(latest.close * 0.0005, latest.high - latest.low);
  }
  const passed = eventOperatorPasses(rule, detected);
  return result(rule, passed, passed ? [{ high, low, midpoint, close: latest.close }] : [], { ruleId: id, lookback });
}

function structural(rule: CanonicalHistoricalRule, candles: NormalizedCandle[]): HistoricalRuleEvaluation {
  const lastClose = candles.at(-1)?.closedAt;
  const swingResult = detectConfirmedSwings(candles, {
    leftBars: numberParameter(rule, 'leftBars', 2), rightBars: numberParameter(rule, 'rightBars', 2),
    equalityPolicy: String(rule.parameters.equalityPolicy ?? 'STRICT') as 'STRICT',
    context: { timeframe: rule.timeframe },
  });
  const structure = reduceMarketStructure(swingResult.swings, rule.parameters.structureConfiguration as Partial<StructureReducerConfig>);
  if (rule.detectorId === 'market-structure.swing') {
    const events = swingResult.swings.filter((event) => event.confirmedAt === lastClose && directionMatches(rule.direction, event.direction === 'HIGH' ? 'BEARISH' : 'BULLISH'));
    return result(rule, eventOperatorPasses(rule, events.length > 0), events, { operator: rule.operator, confirmationDelayBars: numberParameter(rule, 'rightBars', 2), warnings: swingResult.warnings }, candles.length < 5);
  }
  const bos = detectBreaksOfStructure({ candles, confirmedSwings: swingResult.swings, structureSnapshots: structure.snapshots, config: {
    ...(rule.parameters.bosConfiguration as Partial<BreakOfStructureConfig>),
  } });
  if (rule.detectorId === 'market-structure.bos') {
    const events = bos.events.filter((event) => event.detectedAt === lastClose && directionMatches(rule.direction, event.direction));
    return result(rule, eventOperatorPasses(rule, events.length > 0), events, { operator: rule.operator, rejectedCandidates: bos.rejectedCandidates, warnings: bos.warnings }, candles.length < 5);
  }
  if (rule.detectorId === 'market-structure.choch') {
    const shifts = classifyMarketStructureTransitions({ bosEvents: bos.events, confirmedSwings: swingResult.swings, structureSnapshots: structure.snapshots, candles, config: {
      ...(rule.parameters.detectorConfiguration as Partial<MarketStructureShiftConfig>),
      terminologyMode: 'CHOCH_FIRST_THEN_MSS', requireEstablishedBias: Boolean(rule.parameters.requireEstablishedBias),
      minimumPriorDirectionalSnapshots: numberParameter(rule, 'minimumPriorDirectionalSnapshots', 1), requireBreakOfProtectedSwing: Boolean(rule.parameters.requireBreakOfProtectedSwing),
    } });
    const events = shifts.events.filter((event) => event.detectedAt === lastClose && event.classification === 'CHOCH' && directionMatches(rule.direction, event.direction));
    return result(rule, eventOperatorPasses(rule, events.length > 0), events, { operator: rule.operator, rejectedCandidates: shifts.rejectedCandidates, warnings: shifts.warnings }, candles.length < 5);
  }
  const sweeps = detectStructuralLiquiditySweeps({ candles, confirmedSwings: swingResult.swings, structureSnapshots: structure.snapshots, bosEvents: bos.events, config: {
    ...(rule.parameters.detectorConfiguration as Partial<StructuralLiquiditySweepConfig>),
    excursionToleranceAbsolute: numberParameter(rule, 'excursionToleranceAbsolute'), reclaimToleranceAbsolute: numberParameter(rule, 'reclaimToleranceAbsolute'),
    bosConflictPolicy: String(rule.parameters.bosConflictPolicy ?? 'BOS_WINS') as 'BOS_WINS' | 'SWEEP_WINS' | 'REJECT_AMBIGUOUS',
  } });
  const events = sweeps.events.filter((event) => event.detectedAt === lastClose && directionMatches(rule.direction, event.direction === 'SELL_SIDE' ? 'BULLISH' : 'BEARISH'));
  return result(rule, eventOperatorPasses(rule, events.length > 0), events, { operator: rule.operator, rejectedCandidates: sweeps.rejectedCandidates, warnings: sweeps.warnings }, candles.length < 5);
}

function range(rule: CanonicalHistoricalRule, candles: NormalizedCandle[], confirmation: boolean): HistoricalRuleEvaluation {
  const confirmationBars = confirmation ? Math.max(1, numberParameter(rule, 'confirmationBars', 1)) : 1;
  const requireRetest = confirmation && Boolean(rule.parameters.requireRetest);
  const eventBars = confirmationBars + (requireRetest ? 1 : 0);
  const lookback = Math.max(2, numberParameter(rule, 'lookback', 20));
  if (candles.length < lookback + eventBars) return result(rule, false, [], { lookback, confirmationBars, requireRetest }, true);
  const reference = candles.slice(-(lookback + eventBars), -eventBars);
  const events = candles.slice(-eventBars, requireRetest ? -1 : undefined);
  const high = Math.max(...reference.map((candle) => candle.high));
  const low = Math.min(...reference.map((candle) => candle.low));
  const distance = confirmation ? numberParameter(rule, 'minimumDistance') : 0;
  const bullish = events.every((candle) => candle.close > high + distance);
  const bearish = events.every((candle) => candle.close < low - distance);
  const latest = candles.at(-1)!;
  const retestPass = !requireRetest || (bullish && latest.low <= high && latest.close > high) || (bearish && latest.high >= low && latest.close < low);
  const detected = retestPass && ((bullish && directionMatches(rule.direction, 'BULLISH')) || (bearish && directionMatches(rule.direction, 'BEARISH')));
  const passed = eventOperatorPasses(rule, detected);
  return result(rule, passed, passed ? [{ referenceHigh: high, referenceLow: low, eventCandleTimes: candles.slice(-eventBars).map((candle) => candle.closedAt), bullish, bearish, retestConfirmed: retestPass }] : [], { lookback, confirmationBars, minimumDistance: distance, requireRetest });
}

function trend(rule: CanonicalHistoricalRule, series: Record<string, Candle[]>): HistoricalRuleEvaluation {
  const fast = Math.max(1, numberParameter(rule, 'fastPeriod', 10));
  const slow = Math.max(fast + 1, numberParameter(rule, 'slowPeriod', 24));
  const observations = rule.timeframes.map((timeframe) => {
    const values = (series[timeframe] ?? []).map((candle) => candle.close);
    if (values.length < slow) return { timeframe, direction: 'INSUFFICIENT' };
    const fastAverage = values.slice(-fast).reduce((sum, value) => sum + value, 0) / fast;
    const slowAverage = values.slice(-slow).reduce((sum, value) => sum + value, 0) / slow;
    const close = values.at(-1)!;
    return { timeframe, direction: fastAverage > slowAverage && close > slowAverage ? 'BULLISH' : fastAverage < slowAverage && close < slowAverage ? 'BEARISH' : 'RANGE', fastAverage, slowAverage, close };
  });
  const insufficient = observations.some((item) => item.direction === 'INSUFFICIENT');
  const directions = new Set(observations.map((item) => item.direction));
  const actual = directions.size === 1 ? observations[0]?.direction : 'RANGE';
  const detected = !insufficient && actual !== 'RANGE' && actual !== undefined && directionMatches(rule.direction, actual);
  const passed = !insufficient && eventOperatorPasses(rule, detected);
  return result(rule, passed, passed ? observations : [], { fastPeriod: fast, slowPeriod: slow, observations }, insufficient);
}

function evaluate(rule: CanonicalHistoricalRule, series: Record<string, Candle[]>, instrument: string): HistoricalRuleEvaluation {
  if (rule.detectorId === 'market-structure.trend-alignment') return trend(rule, series);
  if (rule.detectorId === 'risk.policy') return riskPolicy(rule);
  const candles = normalized(series[rule.timeframe] ?? [], rule.timeframe);
  if (!candles.length) return result(rule, false, [], { timeframe: rule.timeframe }, true);
  if (['market-structure.swing', 'market-structure.bos', 'market-structure.choch', 'market-structure.liquidity-sweep'].includes(rule.detectorId)) return structural(rule, candles);
  if (rule.detectorId === 'market-structure.state' || rule.detectorId === 'market-structure.level') return structureStateOrLevel(rule, candles);
  if (rule.detectorId === 'price-action.range-break') return range(rule, candles, false);
  if (rule.detectorId === 'price-action.breakout-confirmation') return range(rule, candles, true);
  if (rule.detectorId === 'indicator.technical') return technical(rule, candles);
  if (rule.detectorId === 'price-action.pattern') return pattern(rule, candles);
  if (rule.detectorId === 'price-action.range-state') return rangeState(rule, candles);
  if (rule.detectorId === 'volume.signal') return volumeSignal(rule, candles);
  if (rule.detectorId === 'session.window') return sessionWindow(rule, candles);
  if (rule.detectorId === 'smart-money.zone') return smartMoneyZone(rule, candles, instrument);
  if (rule.detectorId === 'smart-money.order-block') {
    const observation = evaluateOrderBlocks(candles, { instrument, timeframe: rule.timeframe, sourceMaxLookback: numberParameter(rule, 'sourceMaxLookback', 20) });
    const active = observation.orderBlocks.filter((block) => block.eligible && directionMatches(rule.direction, block.direction));
    const newlyConfirmed = observation.orderBlocks.filter((block) => block.confirmationTime === candles.at(-1)?.closedAt && directionMatches(rule.direction, block.direction));
    const passed = lifecycleOperatorPasses(rule, active.length > 0, newlyConfirmed.length > 0);
    const evidence = rule.operator === 'NEWLY_CONFIRMED' ? newlyConfirmed : active;
    return result(rule, passed, evidence, { operator: rule.operator, candidateCount: observation.orderBlocks.length }, candles.length < 2);
  }
  if (rule.detectorId !== 'smart-money.fair-value-gap') throw new Error(`Historical detector ${rule.detectorId} is not implemented.`);
  const observation = detectFairValueGapLifecycles({ candles, config: {
    absoluteTolerance: numberParameter(rule, 'absoluteTolerance'), relativeTolerance: numberParameter(rule, 'relativeTolerance'), minimumGapAbsolute: numberParameter(rule, 'minimumGapAbsolute'),
  } });
  const lastClose = candles.at(-1)?.closedAt;
  const active = observation.gaps.filter((gap) => ['ACTIVE', 'PARTIALLY_MITIGATED'].includes(gap.status) && directionMatches(rule.direction, gap.direction));
  const newlyConfirmed = observation.gaps.filter((gap) => gap.detectedAt === lastClose && directionMatches(rule.direction, gap.direction));
  const passed = lifecycleOperatorPasses(rule, active.length > 0, newlyConfirmed.length > 0);
  const evidence = rule.operator === 'NEWLY_CONFIRMED' ? newlyConfirmed : active;
  return result(rule, passed, evidence, { operator: rule.operator, rejectedCandidates: observation.rejectedCandidates, warnings: observation.warnings }, candles.length < 3);
}

export function evaluateHistoricalRulePlan(plan: HistoricalRulePlan, series: Record<string, Candle[]>, instrument: string): HistoricalRuleEvaluationResult {
  const evaluations = plan.rules.map((rule) => evaluate(rule, series, instrument));
  return Object.freeze({ passed: evaluations.filter((item, index) => plan.rules[index]?.required).every((item) => item.passed), evaluations: Object.freeze(evaluations) });
}
