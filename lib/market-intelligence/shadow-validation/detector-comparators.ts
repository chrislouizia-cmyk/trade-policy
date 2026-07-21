import type { DetectorResult } from '../contracts.ts';
import { compareNumeric, DEFAULT_SHADOW_EPSILON } from './numeric-comparison.ts';
import type { DetectorShadowComparison, LegacyComparableObservation, LegacyComparablePayloads, LegacyComparableDetectorId, ScalarFieldComparison } from './shadow-types.ts';

type FieldMap = { numeric: string[]; scalar: string[] };
const FIELDS: Record<LegacyComparableDetectorId, FieldMap> = {
  atr: { numeric: ['atr'], scalar: ['period', 'smoothingMethod', 'trueRangeCount'] },
  trend: { numeric: ['fastAverage.value', 'slowAverage.value', 'latestClose'], scalar: ['direction', 'fastAverage.period', 'slowAverage.period'] },
  'range-levels': { numeric: ['recentHigh', 'recentLow', 'previousHigh', 'previousLow', 'midpoint', 'range'], scalar: [] },
  'break-of-structure': { numeric: ['referenceHigh', 'referenceLow', 'breakPrice', 'breakDistance'], scalar: ['direction', 'bullishBreak', 'bearishBreak'] },
  'liquidity-sweep': { numeric: ['referenceHigh', 'referenceLow', 'highPenetration', 'lowPenetration'], scalar: ['side', 'highSideSweep', 'lowSideSweep'] },
  'fair-value-gap': { numeric: ['gapTop', 'gapBottom', 'gapSize'], scalar: ['direction', 'bullishGap', 'bearishGap'] },
  'rejection-candle': { numeric: ['bodySize', 'fullRange', 'upperWick', 'lowerWick'], scalar: ['classification', 'rejectionDetected', 'upperRejection', 'lowerRejection'] },
  'volume-expansion': { numeric: ['currentVolume', 'previousVolume', 'thresholdVolume', 'volumeIncrease'], scalar: ['classification', 'expansionDetected', 'volumeAvailable', 'multiplier'] },
  displacement: { numeric: ['bodySize', 'fullRange', 'bodyToRangeRatio', 'atr', 'atrThreshold', 'bodyRatioThreshold', 'effectiveThreshold', 'distanceAboveEffectiveThreshold'], scalar: ['classification', 'displacementDetected', 'atrPeriod', 'atrSmoothingMethod', 'atrThresholdMultiplier', 'bodyRatioThresholdMultiplier', 'bodyAboveAtrThreshold', 'bodyAboveRangeThreshold'] },
  'volatility-requirement': { numeric: ['currentRange', 'atr', 'volatilityThreshold', 'rangeToAtrRatio', 'distanceFromThreshold'], scalar: ['classification', 'volatilityRequirementMet', 'atrPeriod', 'atrSmoothingMethod', 'thresholdMultiplier', 'atrPositive', 'rangeAtOrAboveThreshold'] },
  retest: { numeric: ['targetLevel', 'recentHigh', 'recentLow', 'tolerance', 'atrTolerance', 'priceTolerance', 'distanceToTarget', 'atr', 'currentClose'], scalar: ['classification', 'retestDetected', 'trendBias', 'atrPeriod', 'atrSmoothingMethod'] },
};
const valueAt = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value);
const unavailable = (status: string) => status === 'INSUFFICIENT_DATA';

export function compareDetector(legacy: LegacyComparableObservation, result: DetectorResult | undefined, epsilon = DEFAULT_SHADOW_EPSILON): DetectorShadowComparison {
  const base = { detectorId: legacy.detectorId, timeframe: legacy.timeframe, numericComparisons: [], scalarComparisons: [], legacyStatus: legacy.status, newStatus: result?.status ?? 'MISSING', warnings: [...legacy.warnings, ...(result?.warnings ?? [])] };
  if (legacy.status === 'ERROR' || result?.status === 'ERROR') return { ...base, status: 'ERROR', exactMatch: false, mismatchReasons: ['At least one comparison side returned an error.'] };
  if (legacy.status === 'UNAVAILABLE' && (!result || unavailable(result.status))) return { ...base, status: 'BOTH_UNAVAILABLE', exactMatch: true, mismatchReasons: [] };
  if (legacy.status === 'UNAVAILABLE') return { ...base, status: 'LEGACY_UNAVAILABLE', exactMatch: false, mismatchReasons: ['Legacy observation is unavailable while the detector produced a value.'] };
  if (!result || unavailable(result.status) || result.payload === null) return { ...base, status: 'NEW_UNAVAILABLE', exactMatch: false, mismatchReasons: ['Detector observation is unavailable while the legacy calculation produced a value.'] };
  const fields = FIELDS[legacy.detectorId];
  const numericComparisons = fields.numeric.map((field) => compareNumeric(field, numeric(valueAt(legacy.payload, field)), numeric(valueAt(result.payload, field)), epsilon));
  const scalarComparisons: ScalarFieldComparison[] = fields.scalar.map((field) => { const legacyValue = scalar(valueAt(legacy.payload, field)), newValue = scalar(valueAt(result.payload, field)); return { field, legacyValue, newValue, match: Object.is(legacyValue, newValue) }; });
  const mismatchReasons = [...numericComparisons.filter((item) => item.withinTolerance !== true).map((item) => `${item.field} exceeds tolerance.`), ...scalarComparisons.filter((item) => !item.match).map((item) => `${item.field} does not match.`)];
  const exactMatch = numericComparisons.every((item) => item.exactMatch === true) && scalarComparisons.every((item) => item.match);
  return { ...base, numericComparisons, scalarComparisons, status: mismatchReasons.length ? 'MISMATCH' : 'MATCH', exactMatch, mismatchReasons };
}

function numeric(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function scalar(value: unknown): string | boolean | number | null { return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' ? value : null; }

export function isComparableDetectorId(value: string): value is keyof LegacyComparablePayloads { return value in FIELDS; }
