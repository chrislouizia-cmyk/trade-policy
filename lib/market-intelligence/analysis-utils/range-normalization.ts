export type RangeNormalization = { absoluteRange: number | null; midpoint: number | null; normalizedPosition: number | null; distancePercentOfPrice: number | null; rangeToAtrRatio: number | null };
export function normalizeRange(low: number, high: number, price: number, atr: number | null): RangeNormalization {
  if (![low, high, price].every(Number.isFinite) || high < low) return { absoluteRange: null, midpoint: null, normalizedPosition: null, distancePercentOfPrice: null, rangeToAtrRatio: null };
  const absoluteRange = high - low;
  return { absoluteRange, midpoint: low + absoluteRange / 2, normalizedPosition: absoluteRange === 0 ? null : Math.min(1, Math.max(0, (price - low) / absoluteRange)), distancePercentOfPrice: price === 0 ? null : absoluteRange / Math.abs(price) * 100, rangeToAtrRatio: atr === null || !Number.isFinite(atr) || atr <= 0 ? null : absoluteRange / atr };
}
