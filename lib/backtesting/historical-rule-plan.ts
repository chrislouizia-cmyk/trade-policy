import type { StrategyProfile, StrategyRule, TimeframeRole } from '../../types/trade.ts';
import { isHistoricalTimeframe, normalizeHistoricalTimeframe } from './historical-timeframes.ts';

export const HISTORICAL_RULE_PLAN_VERSION = '1.0.0';

export type HistoricalDetectorId =
  | 'market-structure.swing'
  | 'market-structure.bos'
  | 'market-structure.choch'
  | 'market-structure.liquidity-sweep'
  | 'price-action.range-break'
  | 'price-action.breakout-confirmation'
  | 'market-structure.trend-alignment'
  | 'smart-money.order-block'
  | 'smart-money.fair-value-gap';

export type ParameterSource = Readonly<{ source: 'EXPLICIT' | 'DEFAULT'; version: string }>;
export type CanonicalHistoricalOperator = 'EVENT_CONFIRMED' | 'EVENT_NOT_CONFIRMED' | 'ACTIVE_EXISTS' | 'ACTIVE_MISSING' | 'NEWLY_CONFIRMED';
export type CanonicalHistoricalRule = Readonly<{
  id: string;
  detectorId: HistoricalDetectorId;
  detectorVersion: string;
  configurationVersion: string;
  originalRuleKey: string;
  originalLabel: string;
  required: boolean;
  timeframeRole: TimeframeRole;
  timeframe: string;
  timeframes: readonly string[];
  direction: 'BULLISH' | 'BEARISH' | 'BOTH';
  operator: CanonicalHistoricalOperator;
  originalOperator: string;
  lookback: number | null;
  parameters: Readonly<Record<string, unknown>>;
  parameterSources: Readonly<Record<string, ParameterSource>>;
}>;

export type UnsupportedHistoricalRule = Readonly<{
  ruleKey: string;
  label: string;
  canonicalCandidate: string | null;
  reason: string;
  timeframe: string;
  parameters: Readonly<Record<string, unknown>>;
}>;

export type HistoricalRulePlan = Readonly<{
  version: typeof HISTORICAL_RULE_PLAN_VERSION;
  rules: readonly CanonicalHistoricalRule[];
  unsupportedRequiredRules: readonly UnsupportedHistoricalRule[];
}>;

type DecodedCondition = { ruleId?: string; operator?: string; inputs?: Record<string, unknown>; operands?: unknown[] };
const DETECTOR_VERSION: Record<HistoricalDetectorId, string> = {
  'market-structure.swing': '1.0.0',
  'market-structure.bos': '1.0.0',
  'market-structure.choch': '1.0.0',
  'market-structure.liquidity-sweep': '1.0.0',
  'price-action.range-break': '1.0.0',
  'price-action.breakout-confirmation': '1.0.0',
  'market-structure.trend-alignment': '1.0.0',
  'smart-money.order-block': '1.0.0',
  'smart-money.fair-value-gap': '1.0.0',
};

const aliases: Record<string, HistoricalDetectorId> = {
  swing: 'market-structure.swing', swinghigh: 'market-structure.swing', swinglow: 'market-structure.swing',
  bos: 'market-structure.bos', bosconfirmed: 'market-structure.bos', breakofstructure: 'market-structure.bos', structurebos: 'market-structure.bos',
  choch: 'market-structure.choch', chochconfirmed: 'market-structure.choch', changeofcharacter: 'market-structure.choch', structurechoch: 'market-structure.choch',
  liquiditysweep: 'market-structure.liquidity-sweep', liquiditygrab: 'market-structure.liquidity-sweep', smartmoneyliquiditysweep: 'market-structure.liquidity-sweep',
  rangebreak: 'price-action.range-break', priceactionrangebreak: 'price-action.range-break',
  breakoutconfirmation: 'price-action.breakout-confirmation', priceactionbreakoutconfirmation: 'price-action.breakout-confirmation', breakoutclose: 'price-action.breakout-confirmation',
  trendalignment: 'market-structure.trend-alignment', h4trendaligned: 'market-structure.trend-alignment', h1trendaligned: 'market-structure.trend-alignment', structuretrendalignment: 'market-structure.trend-alignment',
  orderblock: 'smart-money.order-block', smartmoneyorderblock: 'smart-money.order-block',
  fairvaluegap: 'smart-money.fair-value-gap', fvg: 'smart-money.fair-value-gap', smartmoneyfairvaluegap: 'smart-money.fair-value-gap',
};

const EVENT_OPERATORS: Readonly<Record<string, CanonicalHistoricalOperator>> = Object.freeze({
  CONFIRMED: 'EVENT_CONFIRMED', IS_TRUE: 'EVENT_CONFIRMED', IS_FALSE: 'EVENT_NOT_CONFIRMED',
});
const LIFECYCLE_OPERATORS: Readonly<Record<string, CanonicalHistoricalOperator>> = Object.freeze({
  CONFIRMED: 'NEWLY_CONFIRMED', IS_TRUE: 'ACTIVE_EXISTS', EXISTS: 'ACTIVE_EXISTS', WITHIN: 'ACTIVE_EXISTS', IS_FALSE: 'ACTIVE_MISSING', MISSING: 'ACTIVE_MISSING',
});

export const HISTORICAL_OPERATOR_MATRIX: Readonly<Record<HistoricalDetectorId, Readonly<Record<string, CanonicalHistoricalOperator>>>> = Object.freeze({
  'market-structure.swing': EVENT_OPERATORS,
  'market-structure.bos': EVENT_OPERATORS,
  'market-structure.choch': EVENT_OPERATORS,
  'market-structure.liquidity-sweep': EVENT_OPERATORS,
  'price-action.range-break': EVENT_OPERATORS,
  'price-action.breakout-confirmation': EVENT_OPERATORS,
  'market-structure.trend-alignment': EVENT_OPERATORS,
  'smart-money.order-block': LIFECYCLE_OPERATORS,
  'smart-money.fair-value-gap': LIFECYCLE_OPERATORS,
});

const roleField: Record<TimeframeRole, keyof StrategyProfile> = { MACRO: 'macroTimeframe', TREND: 'trendTimeframe', CONFIRMATION: 'confirmationTimeframe', ENTRY: 'entryTimeframe', TRIGGER: 'triggerTimeframe' };
const token = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const explicit = (): ParameterSource => ({ source: 'EXPLICIT', version: HISTORICAL_RULE_PLAN_VERSION });
const defaulted = (): ParameterSource => ({ source: 'DEFAULT', version: HISTORICAL_RULE_PLAN_VERSION });

function decodeRuleKey(ruleKey: string): DecodedCondition | null {
  if (!ruleKey.startsWith('dna.v1.')) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(ruleKey.slice('dna.v1.'.length))) as { condition?: DecodedCondition };
    return parsed.condition ?? null;
  } catch {
    return null;
  }
}

function numberValue(inputs: Record<string, unknown>, keys: string[], fallback: number, sources: Record<string, ParameterSource>, outputKey = keys[0]): number {
  const match = keys.find((key) => Number.isFinite(Number(inputs[key])));
  sources[outputKey] = match ? explicit() : defaulted();
  return match ? Number(inputs[match]) : fallback;
}

function directionValue(inputs: Record<string, unknown>, sources: Record<string, ParameterSource>): 'BULLISH' | 'BEARISH' | 'BOTH' {
  const raw = String(inputs.direction ?? '').toUpperCase();
  const direction = ['BULLISH', 'BUY', 'LONG'].includes(raw) ? 'BULLISH' : ['BEARISH', 'SELL', 'SHORT'].includes(raw) ? 'BEARISH' : 'BOTH';
  sources.direction = direction === 'BOTH' ? defaulted() : explicit();
  return direction;
}

function detectorFor(rule: StrategyRule, decoded: DecodedCondition | null): HistoricalDetectorId | null {
  const candidates = [decoded?.ruleId, rule.ruleKey, rule.label].filter((value): value is string => typeof value === 'string');
  for (const candidate of candidates) {
    const normalized = token(candidate);
    const withoutTimeframe = normalized.replace(/(?:m1|m3|m5|m15|m30|h1|h2|h4|d1|w1)$/, '');
    const found = aliases[normalized] ?? aliases[withoutTimeframe];
    if (found) return found;
  }
  return null;
}

function timeframeFor(strategy: StrategyProfile, rule: StrategyRule, inputs: Record<string, unknown>): { timeframe: string; source: ParameterSource } {
  const supplied = typeof inputs.timeframe === 'string' ? normalizeHistoricalTimeframe(inputs.timeframe) : '';
  if (supplied) return { timeframe: supplied, source: explicit() };
  const labelled = rule.label.match(/\b(M1|M3|M5|M15|M30|H1|H2|H4|D1|W1)\b/i)?.[1]?.toUpperCase();
  if (labelled) return { timeframe: labelled, source: explicit() };
  const value = strategy[roleField[rule.timeframeRole]];
  return { timeframe: typeof value === 'string' ? normalizeHistoricalTimeframe(value) : '', source: defaulted() };
}

const STRUCTURE_CONFIGURATION = Object.freeze({ equalityToleranceAbsolute: 0, equalityToleranceRelative: 0, minimumSwingSeparationBars: 0, sameDirectionReplacementPolicy: 'KEEP_ALL', outsideCandlePolicy: 'PROCESS_HIGH_THEN_LOW' });
const BOS_CONFIGURATION = Object.freeze({ swingEligibility: 'LATEST_ACCEPTED_STRUCTURE', requireDirectionalBias: 'NONE', sourceSwingLabels: { bullish: ['INITIAL_HIGH', 'HH', 'LH', 'EH'], bearish: ['INITIAL_LOW', 'HL', 'LL', 'EL'] }, duplicateBreakPolicy: 'EMIT_ONCE_PER_SWING' });
const CHOCH_CONFIGURATION = Object.freeze({ terminologyMode: 'CHOCH_FIRST_THEN_MSS', protectedSwingPolicy: 'LAST_HL_FOR_BULLISH_LAST_LH_FOR_BEARISH', requireDisplacement: false, minimumBreakDistanceAbsolute: 0, minimumBreakDistanceRelative: 0, minimumBreakDistanceAtrMultiple: 0, atrPeriod: 14, duplicatePolicy: 'ONE_SHIFT_PER_PRIOR_BIAS_REGIME', transitionResetPolicy: 'AFTER_NEW_DIRECTIONAL_STRUCTURE' });
const SWEEP_CONFIGURATION = Object.freeze({ sourceEligibility: 'LATEST_ACCEPTED_STRUCTURE', allowedSourceLabels: { buySide: ['INITIAL_HIGH', 'HH', 'LH', 'EH'], sellSide: ['INITIAL_LOW', 'HL', 'LL', 'EL'] }, excursionToleranceRelative: 0, reclaimToleranceRelative: 0, minimumExcursionAbsolute: 0, minimumExcursionRelative: 0, minimumExcursionAtrMultiple: 0, atrPeriod: 14, closePolicy: 'CLOSE_AT_OR_INSIDE', consumptionPolicy: 'CONSUME_ONCE', repeatResetPolicy: 'AFTER_NEW_STRUCTURAL_LEVEL', gapPolicy: 'ALLOW', sameCandleDualSweepPolicy: 'REJECT_AMBIGUOUS' });

function canonicalRule(strategy: StrategyProfile, rule: StrategyRule, index: number): CanonicalHistoricalRule | UnsupportedHistoricalRule {
  const decoded = decodeRuleKey(rule.ruleKey);
  const inputs = decoded?.inputs ?? {};
  const detectorId = detectorFor(rule, decoded);
  const resolvedTimeframe = timeframeFor(strategy, rule, inputs);
  if (!detectorId) return { ruleKey: rule.ruleKey, label: rule.label, canonicalCandidate: decoded?.ruleId ?? null, reason: 'No canonical historical detector alias is registered.', timeframe: resolvedTimeframe.timeframe, parameters: inputs };
  if (!resolvedTimeframe.timeframe) return { ruleKey: rule.ruleKey, label: rule.label, canonicalCandidate: detectorId, reason: `No timeframe is configured for role ${rule.timeframeRole}.`, timeframe: '', parameters: inputs };
  if (!isHistoricalTimeframe(resolvedTimeframe.timeframe)) return { ruleKey: rule.ruleKey, label: rule.label, canonicalCandidate: detectorId, reason: `Historical timeframe ${resolvedTimeframe.timeframe} is not supported by the production provider.`, timeframe: resolvedTimeframe.timeframe, parameters: inputs };
  const originalOperator = String(decoded?.operator ?? 'CONFIRMED').trim().toUpperCase();
  const operator = HISTORICAL_OPERATOR_MATRIX[detectorId][originalOperator];
  if (!operator) return { ruleKey: rule.ruleKey, label: rule.label, canonicalCandidate: detectorId, reason: `Operator ${originalOperator || '(blank)'} is not supported by historical detector ${detectorId}.`, timeframe: resolvedTimeframe.timeframe, parameters: inputs };

  const sources: Record<string, ParameterSource> = Object.fromEntries(Object.keys(inputs).map((key) => [key, explicit()]));
  sources.timeframe = resolvedTimeframe.source;
  const direction = directionValue(inputs, sources);
  const parameters: Record<string, unknown> = { ...inputs };
  let lookback: number | null = null;
  let timeframes: string[] = [resolvedTimeframe.timeframe];
  if (['market-structure.swing', 'market-structure.bos', 'market-structure.choch', 'market-structure.liquidity-sweep'].includes(detectorId)) {
    parameters.leftBars = numberValue(inputs, ['leftBars'], 2, sources);
    parameters.rightBars = numberValue(inputs, ['rightBars'], 2, sources);
    parameters.equalityPolicy = inputs.equalityPolicy ?? 'STRICT'; sources.equalityPolicy = inputs.equalityPolicy ? explicit() : defaulted();
    parameters.structureConfiguration = STRUCTURE_CONFIGURATION; sources.structureConfiguration = defaulted();
    if (detectorId !== 'market-structure.swing') {
      parameters.bosConfiguration = { ...BOS_CONFIGURATION, closeToleranceAbsolute: 0, closeToleranceRelative: 0, gapBreakPolicy: 'ALLOW' };
      sources.bosConfiguration = defaulted();
    }
  }
  switch (detectorId) {
    case 'market-structure.swing':
      break;
    case 'market-structure.bos':
      parameters.closeToleranceAbsolute = numberValue(inputs, ['closeToleranceAbsolute', 'tolerance'], 0, sources);
      parameters.closeToleranceRelative = numberValue(inputs, ['closeToleranceRelative'], 0, sources);
      parameters.gapBreakPolicy = inputs.gapBreakPolicy ?? 'ALLOW'; sources.gapBreakPolicy = inputs.gapBreakPolicy ? explicit() : defaulted();
      parameters.bosConfiguration = { ...BOS_CONFIGURATION, closeToleranceAbsolute: parameters.closeToleranceAbsolute, closeToleranceRelative: parameters.closeToleranceRelative, gapBreakPolicy: parameters.gapBreakPolicy };
      sources.bosConfiguration = Object.keys(inputs).some((key) => ['closeToleranceAbsolute', 'tolerance', 'closeToleranceRelative', 'gapBreakPolicy'].includes(key)) ? explicit() : defaulted();
      break;
    case 'market-structure.choch':
      parameters.detectorConfiguration = CHOCH_CONFIGURATION; sources.detectorConfiguration = defaulted();
      parameters.requireEstablishedBias = inputs.requireEstablishedBias ?? true; sources.requireEstablishedBias = inputs.requireEstablishedBias === undefined ? defaulted() : explicit();
      parameters.minimumPriorDirectionalSnapshots = numberValue(inputs, ['minimumPriorDirectionalSnapshots'], 1, sources);
      parameters.requireBreakOfProtectedSwing = inputs.requireBreakOfProtectedSwing ?? true; sources.requireBreakOfProtectedSwing = inputs.requireBreakOfProtectedSwing === undefined ? defaulted() : explicit();
      break;
    case 'market-structure.liquidity-sweep':
      parameters.detectorConfiguration = SWEEP_CONFIGURATION; sources.detectorConfiguration = defaulted();
      parameters.excursionToleranceAbsolute = numberValue(inputs, ['excursionToleranceAbsolute'], 0, sources);
      parameters.reclaimToleranceAbsolute = numberValue(inputs, ['reclaimToleranceAbsolute'], 0, sources);
      parameters.bosConflictPolicy = inputs.bosConflictPolicy ?? 'BOS_WINS'; sources.bosConflictPolicy = inputs.bosConflictPolicy ? explicit() : defaulted();
      break;
    case 'price-action.range-break':
      lookback = numberValue(inputs, ['lookback', 'period'], 20, sources, 'lookback'); parameters.lookback = lookback;
      break;
    case 'price-action.breakout-confirmation':
      lookback = numberValue(inputs, ['lookback', 'period'], 20, sources, 'lookback'); parameters.lookback = lookback;
      parameters.confirmationBars = numberValue(inputs, ['confirmationBars'], 1, sources);
      parameters.minimumDistance = numberValue(inputs, ['minimumDistance', 'threshold'], 0, sources);
      parameters.requireRetest = inputs.requireRetest ?? false; sources.requireRetest = inputs.requireRetest === undefined ? defaulted() : explicit();
      break;
    case 'market-structure.trend-alignment': {
      parameters.fastPeriod = numberValue(inputs, ['fastPeriod'], 10, sources);
      parameters.slowPeriod = numberValue(inputs, ['slowPeriod'], 24, sources);
      const suppliedFrames = Array.isArray(inputs.timeframes) ? inputs.timeframes.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map(normalizeHistoricalTimeframe) : [];
      timeframes = suppliedFrames.length ? suppliedFrames : [strategy.trendTimeframe, strategy.confirmationTimeframe].filter((value): value is string => typeof value === 'string' && Boolean(value)).map(normalizeHistoricalTimeframe);
      const invalidFrame = timeframes.find((timeframe) => !isHistoricalTimeframe(timeframe));
      if (invalidFrame) return { ruleKey: rule.ruleKey, label: rule.label, canonicalCandidate: detectorId, reason: `Historical timeframe ${invalidFrame} is not supported by the production provider.`, timeframe: invalidFrame, parameters: inputs };
      sources.timeframes = suppliedFrames.length ? explicit() : defaulted(); parameters.timeframes = timeframes;
      break;
    }
    case 'smart-money.order-block':
      lookback = numberValue(inputs, ['sourceMaxLookback', 'lookback'], 20, sources, 'sourceMaxLookback'); parameters.sourceMaxLookback = lookback;
      break;
    case 'smart-money.fair-value-gap':
      parameters.absoluteTolerance = numberValue(inputs, ['absoluteTolerance'], 0, sources);
      parameters.relativeTolerance = numberValue(inputs, ['relativeTolerance'], 0, sources);
      parameters.minimumGapAbsolute = numberValue(inputs, ['minimumGapAbsolute', 'threshold'], 0, sources);
      break;
  }
  return Object.freeze({ id: `historical-rule:${index}:${detectorId}`, detectorId, detectorVersion: DETECTOR_VERSION[detectorId], configurationVersion: HISTORICAL_RULE_PLAN_VERSION, originalRuleKey: rule.ruleKey, originalLabel: rule.label, required: rule.mandatory, timeframeRole: rule.timeframeRole, timeframe: resolvedTimeframe.timeframe, timeframes: Object.freeze(timeframes), direction, operator, originalOperator, lookback, parameters: Object.freeze(parameters), parameterSources: Object.freeze(sources) });
}

export function buildHistoricalRulePlan(strategy: StrategyProfile): HistoricalRulePlan {
  const rules: CanonicalHistoricalRule[] = [];
  const unsupportedRequiredRules: UnsupportedHistoricalRule[] = [];
  for (const [index, rule] of (strategy.rules ?? []).entries()) {
    if (!rule.enabled) continue;
    const executable = (rule.evaluationMode ?? 'AUTOMATIC') === 'AUTOMATIC';
    if (!executable) {
      if (rule.mandatory) unsupportedRequiredRules.push({ ruleKey: rule.ruleKey, label: rule.label, canonicalCandidate: null, reason: `Required ${rule.evaluationMode ?? 'MANUAL'} rule is not historically executable.`, timeframe: String(strategy[roleField[rule.timeframeRole]] ?? ''), parameters: {} });
      continue;
    }
    const result = canonicalRule(strategy, rule, index);
    if ('reason' in result) {
      if (rule.mandatory) unsupportedRequiredRules.push(result);
    } else rules.push(result);
  }
  return Object.freeze({ version: HISTORICAL_RULE_PLAN_VERSION, rules: Object.freeze(rules), unsupportedRequiredRules: Object.freeze(unsupportedRequiredRules) });
}

export function assertHistoricalRulePlanSupported(plan: HistoricalRulePlan): void {
  if (!plan.unsupportedRequiredRules.length) return;
  const error = new Error('Required strategy rules are not supported by deterministic historical detectors.') as Error & { unsupportedRules?: readonly UnsupportedHistoricalRule[] };
  error.unsupportedRules = plan.unsupportedRequiredRules;
  throw error;
}
