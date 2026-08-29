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
  const candles = normalized(series[rule.timeframe] ?? [], rule.timeframe);
  if (!candles.length) return result(rule, false, [], { timeframe: rule.timeframe }, true);
  if (rule.detectorId.startsWith('market-structure.')) return structural(rule, candles);
  if (rule.detectorId === 'price-action.range-break') return range(rule, candles, false);
  if (rule.detectorId === 'price-action.breakout-confirmation') return range(rule, candles, true);
  if (rule.detectorId === 'smart-money.order-block') {
    const observation = evaluateOrderBlocks(candles, { instrument, timeframe: rule.timeframe, sourceMaxLookback: numberParameter(rule, 'sourceMaxLookback', 20) });
    const active = observation.orderBlocks.filter((block) => block.eligible && directionMatches(rule.direction, block.direction));
    const newlyConfirmed = observation.orderBlocks.filter((block) => block.confirmationTime === candles.at(-1)?.closedAt && directionMatches(rule.direction, block.direction));
    const passed = lifecycleOperatorPasses(rule, active.length > 0, newlyConfirmed.length > 0);
    const evidence = rule.operator === 'NEWLY_CONFIRMED' ? newlyConfirmed : active;
    return result(rule, passed, evidence, { operator: rule.operator, candidateCount: observation.orderBlocks.length }, candles.length < 2);
  }
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
