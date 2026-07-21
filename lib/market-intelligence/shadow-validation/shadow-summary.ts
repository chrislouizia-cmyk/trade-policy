import type { DetectorShadowComparison, ShadowValidationSummary } from './shadow-types.ts';

export function summarizeShadowComparisons(comparisons: readonly DetectorShadowComparison[]): ShadowValidationSummary {
  const matches = comparisons.filter((item) => item.status === 'MATCH').length;
  const mismatches = comparisons.filter((item) => item.status === 'MISMATCH').length;
  const notComparable = comparisons.filter((item) => item.status === 'NOT_COMPARABLE').length;
  const unavailable = comparisons.filter((item) => ['LEGACY_UNAVAILABLE', 'NEW_UNAVAILABLE', 'BOTH_UNAVAILABLE'].includes(item.status)).length;
  const errors = comparisons.filter((item) => item.status === 'ERROR').length;
  const comparable = matches + mismatches;
  return { totalComparisons: comparisons.length, matches, mismatches, notComparable, unavailable, errors, matchRate: comparable ? matches / comparable : null };
}
