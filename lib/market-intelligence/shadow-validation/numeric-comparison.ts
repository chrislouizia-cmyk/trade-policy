import type { NumericFieldComparison } from './shadow-types.ts';

export const DEFAULT_SHADOW_EPSILON = 1e-10;

export function compareNumeric(field: string, legacyValue: number | null, newValue: number | null, epsilon = DEFAULT_SHADOW_EPSILON): NumericFieldComparison {
  if (legacyValue === null || newValue === null) return { field, legacyValue, newValue, exactMatch: legacyValue === newValue, absoluteDelta: null, relativeDeltaPercent: null, withinTolerance: legacyValue === newValue };
  const absoluteDelta = Math.abs(legacyValue - newValue);
  const divisor = Math.abs(legacyValue);
  return { field, legacyValue, newValue, exactMatch: Object.is(legacyValue, newValue), absoluteDelta, relativeDeltaPercent: divisor === 0 ? (absoluteDelta === 0 ? 0 : null) : absoluteDelta / divisor * 100, withinTolerance: absoluteDelta <= epsilon };
}
