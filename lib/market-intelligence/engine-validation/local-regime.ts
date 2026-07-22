import type { NormalizedCandle } from '../contracts.ts';

export const LOCAL_REGIME_METHOD_VERSION = 'LOCAL_SMA20_SLOPE_PRICE_V1' as const;
export type LocalMarketRegime = 'BULLISH' | 'BEARISH' | 'RANGE';

export type LocalRegimeObservation = Readonly<{
  methodVersion: typeof LOCAL_REGIME_METHOD_VERSION;
  regime: LocalMarketRegime;
  earlySma20: number;
  lateSma20: number;
  smaChangePercent: number;
  currentClose: number;
  sourceStartAt: string;
  sourceEndAt: string;
  candleCount: number;
}>;

const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Strategy-independent, point-in-time regime label. Uses only the supplied completed window. */
export function classifyLocalMarketRegime(candles: readonly NormalizedCandle[]): LocalRegimeObservation {
  if (candles.length < 21) throw new Error('Local regime classification requires at least 21 completed candles.');
  if (candles.some((candle) => !candle.complete || !Number.isFinite(candle.close))) throw new Error('Local regime classification requires valid completed candles.');
  const earlySma20 = average(candles.slice(0, 20).map((candle) => candle.close));
  const lateSma20 = average(candles.slice(-20).map((candle) => candle.close));
  const currentClose = candles.at(-1)!.close;
  const regime: LocalMarketRegime = lateSma20 > earlySma20 && currentClose > lateSma20
    ? 'BULLISH'
    : lateSma20 < earlySma20 && currentClose < lateSma20
      ? 'BEARISH'
      : 'RANGE';
  return Object.freeze({ methodVersion: LOCAL_REGIME_METHOD_VERSION, regime, earlySma20, lateSma20, smaChangePercent: earlySma20 === 0 ? 0 : (lateSma20 - earlySma20) / Math.abs(earlySma20) * 100, currentClose, sourceStartAt: candles[0]!.openedAt, sourceEndAt: candles.at(-1)!.closedAt, candleCount: candles.length });
}
