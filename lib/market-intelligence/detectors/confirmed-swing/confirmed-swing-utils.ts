import { canonicalStringify, stableFingerprint } from '../../serialization/stable-fingerprint.ts';
import { simpleAtr, validateCandles } from '../../analysis-utils/index.ts';
import type { NormalizedCandle } from '../../contracts.ts';
import type { ConfirmedSwing, IncrementalSwingDetector, SwingDetectionResult, SwingDetectorConfig, SwingDirection, SwingEqualityPolicy } from './confirmed-swing-types.ts';

export const DEFAULT_SWING_DETECTOR_CONFIG: SwingDetectorConfig = Object.freeze({
  leftBars: 2,
  rightBars: 2,
  equalityPolicy: 'STRICT',
});

export class SwingDetectionError extends Error {
  readonly code: 'INVALID_CONFIGURATION' | 'INVALID_CANDLES' | 'INCOMPLETE_CANDLE';
  constructor(code: 'INVALID_CONFIGURATION' | 'INVALID_CANDLES' | 'INCOMPLETE_CANDLE', message: string) {
    super(message);
    this.name = 'SwingDetectionError';
    this.code = code;
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizedConfig(input: Partial<SwingDetectorConfig> = {}): SwingDetectorConfig {
  const config = { ...DEFAULT_SWING_DETECTOR_CONFIG, ...input, ...(input.context ? { context: { ...input.context } } : {}) };
  if (!Number.isInteger(config.leftBars) || config.leftBars < 1) throw new SwingDetectionError('INVALID_CONFIGURATION', 'leftBars must be a positive integer.');
  if (!Number.isInteger(config.rightBars) || config.rightBars < 1) throw new SwingDetectionError('INVALID_CONFIGURATION', 'rightBars must be a positive integer.');
  if (!['STRICT', 'ALLOW_EQUAL_LEFT', 'ALLOW_EQUAL_RIGHT', 'ALLOW_EQUAL_BOTH'].includes(config.equalityPolicy)) throw new SwingDetectionError('INVALID_CONFIGURATION', 'Unsupported equality policy.');
  if (config.minimumProminence !== undefined && (!Number.isFinite(config.minimumProminence) || config.minimumProminence < 0)) throw new SwingDetectionError('INVALID_CONFIGURATION', 'minimumProminence must be a non-negative finite number.');
  if (config.minimumProminenceAtrMultiple !== undefined && (!Number.isFinite(config.minimumProminenceAtrMultiple) || config.minimumProminenceAtrMultiple < 0)) throw new SwingDetectionError('INVALID_CONFIGURATION', 'minimumProminenceAtrMultiple must be a non-negative finite number.');
  const atrPeriod = config.atrPeriod ?? 14;
  if (config.minimumProminenceAtrMultiple !== undefined && (!Number.isInteger(atrPeriod) || atrPeriod < 1)) throw new SwingDetectionError('INVALID_CONFIGURATION', 'atrPeriod must be a positive integer when ATR prominence is configured.');
  return deepFreeze({ ...config, ...(config.minimumProminenceAtrMultiple === undefined && input.atrPeriod === undefined ? {} : { atrPeriod }) });
}

function validateInput(candles: readonly NormalizedCandle[]): void {
  const validation = validateCandles(candles);
  const issues = [...validation.issues];
  candles.forEach((candle, index) => {
    const opened = Date.parse(candle.openedAt);
    const closed = Date.parse(candle.closedAt);
    if (Number.isFinite(opened) && Number.isFinite(closed) && closed <= opened) issues.push({ code: 'INVALID_CANDLE_INTERVAL', message: 'Candle closedAt must be after openedAt.', candleIndex: index });
    if (!candle.complete) issues.push({ code: 'INCOMPLETE_CANDLE', message: 'Confirmed swing APIs accept completed candles only.', candleIndex: index });
  });
  if (issues.length) {
    const incompleteOnly = issues.every((issue) => issue.code === 'INCOMPLETE_CANDLE');
    throw new SwingDetectionError(incompleteOnly ? 'INCOMPLETE_CANDLE' : 'INVALID_CANDLES', issues.map((issue) => `${issue.code}${issue.candleIndex === undefined ? '' : ` at ${issue.candleIndex}`}: ${issue.message}`).join(' '));
  }
}

function allowsEqual(policy: SwingEqualityPolicy, side: 'LEFT' | 'RIGHT'): boolean {
  return policy === 'ALLOW_EQUAL_BOTH' || policy === `ALLOW_EQUAL_${side}`;
}

function qualifies(direction: SwingDirection, candidate: NormalizedCandle, neighbors: readonly NormalizedCandle[], allowEqual: boolean): boolean {
  const pivot = direction === 'HIGH' ? candidate.high : candidate.low;
  return neighbors.every((neighbor) => {
    const value = direction === 'HIGH' ? neighbor.high : neighbor.low;
    return direction === 'HIGH' ? allowEqual ? pivot >= value : pivot > value : allowEqual ? pivot <= value : pivot < value;
  });
}

function candidateAt(candles: readonly NormalizedCandle[], pivotIndex: number, direction: SwingDirection, config: SwingDetectorConfig, warnings: string[]): ConfirmedSwing | null {
  const candidate = candles[pivotIndex]!;
  const confirmedIndex = pivotIndex + config.rightBars;
  const left = candles.slice(pivotIndex - config.leftBars, pivotIndex);
  const right = candles.slice(pivotIndex + 1, confirmedIndex + 1);
  const price = direction === 'HIGH' ? candidate.high : candidate.low;
  const equalLeft = left.some((candle) => (direction === 'HIGH' ? candle.high : candle.low) === price);
  const equalRight = right.some((candle) => (direction === 'HIGH' ? candle.high : candle.low) === price);
  if (!qualifies(direction, candidate, left, allowsEqual(config.equalityPolicy, 'LEFT')) || !qualifies(direction, candidate, right, allowsEqual(config.equalityPolicy, 'RIGHT'))) return null;
  const surroundingPrices = [...left, ...right].map((candle) => direction === 'HIGH' ? candle.high : candle.low);
  const reference = direction === 'HIGH' ? Math.max(...surroundingPrices) : Math.min(...surroundingPrices);
  const prominence = direction === 'HIGH' ? price - reference : reference - price;
  if (config.minimumProminence !== undefined && prominence < config.minimumProminence) return null;
  let prominenceAtrMultiple: number | null = null;
  if (config.minimumProminenceAtrMultiple !== undefined) {
    const atr = simpleAtr(candles.slice(0, confirmedIndex + 1), config.atrPeriod ?? 14);
    if (!atr.sufficientData || atr.value === null) {
      warnings.push(`Skipped ${direction} candidate at index ${pivotIndex}: ATR(${config.atrPeriod ?? 14}) is unavailable at confirmedAt.`);
      return null;
    }
    prominenceAtrMultiple = atr.value === 0 ? null : prominence / atr.value;
    if (prominence < atr.value * config.minimumProminenceAtrMultiple) return null;
  }
  const local = candles.slice(pivotIndex - config.leftBars, confirmedIndex + 1);
  const localRange = Math.max(...local.map((candle) => candle.high)) - Math.min(...local.map((candle) => candle.low));
  const strength = localRange === 0 ? 0 : Math.min(1, Math.max(0, prominence / localRange));
  const identity = {
    context: config.context ?? null,
    direction,
    pivotAt: candidate.openedAt,
    price,
    configuration: config,
  };
  return deepFreeze({
    id: `confirmed-swing:${stableFingerprint(identity)}`,
    direction,
    pivotIndex,
    confirmedIndex,
    pivotAt: candidate.openedAt,
    confirmedAt: candles[confirmedIndex]!.closedAt,
    price,
    leftBars: config.leftBars,
    rightBars: config.rightBars,
    prominence,
    prominenceAtrMultiple,
    strength,
    equalPriceConflict: equalLeft || equalRight,
    sourceCandle: { open: candidate.open, high: candidate.high, low: candidate.low, close: candidate.close },
  });
}

function detectAt(candles: readonly NormalizedCandle[], pivotIndex: number, config: SwingDetectorConfig, warnings: string[]): ConfirmedSwing[] {
  if (pivotIndex < config.leftBars || pivotIndex + config.rightBars >= candles.length) return [];
  const swings: ConfirmedSwing[] = [];
  const high = candidateAt(candles, pivotIndex, 'HIGH', config, warnings);
  const low = candidateAt(candles, pivotIndex, 'LOW', config, warnings);
  // An outside candle may be both. Preserve both observations in stable HIGH-then-LOW order.
  if (high) swings.push(high);
  if (low) swings.push(low);
  return swings;
}

export function detectConfirmedSwings(candles: readonly NormalizedCandle[], input: Partial<SwingDetectorConfig> = {}): SwingDetectionResult {
  const configuration = normalizedConfig(input);
  validateInput(candles);
  const swings: ConfirmedSwing[] = [];
  const warnings: string[] = [];
  for (let pivotIndex = configuration.leftBars; pivotIndex + configuration.rightBars < candles.length; pivotIndex++) swings.push(...detectAt(candles, pivotIndex, configuration, warnings));
  return deepFreeze({ swings, warnings, configuration });
}

export function createSwingDetector(input: Partial<SwingDetectorConfig> = {}): IncrementalSwingDetector {
  const configuration = normalizedConfig(input);
  const candles: NormalizedCandle[] = [];
  const all: ConfirmedSwing[] = [];
  let newlyConfirmed: ConfirmedSwing[] = [];
  const api: IncrementalSwingDetector = {
    push(candle) {
      validateInput([candle]);
      const previous = candles.at(-1);
      if (previous && Date.parse(candle.openedAt) <= Date.parse(previous.openedAt)) throw new SwingDetectionError('INVALID_CANDLES', 'Incremental candle timestamps must be unique and strictly ascending.');
      candles.push(deepFreeze(structuredClone(candle)));
      const pivotIndex = candles.length - 1 - configuration.rightBars;
      newlyConfirmed = detectAt(candles, pivotIndex, configuration, []).map((swing) => deepFreeze(swing));
      all.push(...newlyConfirmed);
      return deepFreeze([...newlyConfirmed]);
    },
    getNewlyConfirmedSwings() {
      const result = deepFreeze([...newlyConfirmed]);
      newlyConfirmed = [];
      return result;
    },
    getAllConfirmedSwings() {
      return deepFreeze([...all]);
    },
    reset() {
      candles.length = 0;
      all.length = 0;
      newlyConfirmed = [];
    },
  };
  return Object.freeze(api);
}

export function serializeSwingDetection(result: SwingDetectionResult): string {
  return canonicalStringify(result);
}
