export type SmaResult = { value: number | null; period: number; source: string; sampleCount: number; sufficientData: boolean };
export function simpleMovingAverage(values: readonly number[], period: number, source = 'value'): SmaResult {
  const validPeriod = Number.isInteger(period) && period > 0; const samples = validPeriod ? values.slice(-period) : []; const valid = samples.every(Number.isFinite); const sufficientData = validPeriod && samples.length === period && valid;
  return { value: sufficientData ? samples.reduce((total, value) => total + value, 0) / period : null, period, source, sampleCount: samples.length, sufficientData };
}
