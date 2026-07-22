import type { Interval } from './validation-types.ts';

const clamp = (value: number, low = 0, high = 1): number => Math.min(high, Math.max(low, value));

export function wilsonInterval(successes: number, total: number, confidenceLevel = .95): Interval {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || total <= 0 || successes > total) throw new Error('Wilson interval requires valid positive counts.');
  const z = confidenceLevel === .99 ? 2.575829 : confidenceLevel === .9 ? 1.644854 : 1.959964;
  const p = successes / total, z2 = z * z, denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return { estimate: p, lower: clamp(center - margin), upper: clamp(center + margin), confidenceLevel };
}

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}

const quantile = (sorted: readonly number[], probability: number): number => {
  const position = (sorted.length - 1) * probability, lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
};

export function bootstrapMean(values: readonly number[], iterations: number, seed: number, confidenceLevel = .95): Interval | null {
  if (!values.length) return null;
  if (values.some((value) => !Number.isFinite(value))) throw new Error('Bootstrap values must be finite.');
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length === 1 || iterations < 2) return { estimate: mean, lower: mean, upper: mean, confidenceLevel };
  const random = generator(seed), estimates: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += values[Math.floor(random() * values.length)]!;
    estimates.push(total / values.length);
  }
  estimates.sort((a, b) => a - b);
  const alpha = (1 - confidenceLevel) / 2;
  return { estimate: mean, lower: quantile(estimates, alpha), upper: quantile(estimates, 1 - alpha), confidenceLevel };
}

export function bootstrapDifference(left: readonly number[], right: readonly number[], iterations: number, seed: number, confidenceLevel = .95): Interval | null {
  if (!left.length || !right.length) return null;
  const random = generator(seed), differences: number[] = [];
  const estimate = left.reduce((a, b) => a + b, 0) / left.length - right.reduce((a, b) => a + b, 0) / right.length;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let leftTotal = 0, rightTotal = 0;
    for (let index = 0; index < left.length; index += 1) leftTotal += left[Math.floor(random() * left.length)]!;
    for (let index = 0; index < right.length; index += 1) rightTotal += right[Math.floor(random() * right.length)]!;
    differences.push(leftTotal / left.length - rightTotal / right.length);
  }
  differences.sort((a, b) => a - b);
  const alpha = (1 - confidenceLevel) / 2;
  return { estimate, lower: quantile(differences, alpha), upper: quantile(differences, 1 - alpha), confidenceLevel };
}

export function bootstrapStatistic<T>(values: readonly T[], statistic: (sample: readonly T[]) => number | null, iterations: number, seed: number, confidenceLevel = .95): Interval | null {
  const estimate = statistic(values);
  if (estimate === null || !Number.isFinite(estimate) || !values.length) return null;
  const random = generator(seed), estimates: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]!);
    const value = statistic(sample);
    if (value !== null && Number.isFinite(value)) estimates.push(value);
  }
  if (!estimates.length) return { estimate, lower: estimate, upper: estimate, confidenceLevel };
  estimates.sort((a, b) => a - b);
  const alpha = (1 - confidenceLevel) / 2;
  return { estimate, lower: quantile(estimates, alpha), upper: quantile(estimates, 1 - alpha), confidenceLevel };
}
