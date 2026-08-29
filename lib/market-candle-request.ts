import { z } from 'zod';
import { isSupportedInstrument } from './instrument-registry.ts';
import { isMarketDataTimeframe } from './market-data.ts';

const schema = z.object({ instrument: z.string().trim().min(1).max(20), timeframe: z.string().trim().min(1).max(8), from: z.string().datetime(), to: z.string().datetime() });

export type MarketCandleRequest = Readonly<{ instrument: string; timeframe: string; from: string; to: string }>;
export type MarketCandleRequestResult = Readonly<{ ok: true; value: MarketCandleRequest } | { ok: false; code: string; message: string; details?: unknown }>;

export function parseMarketCandleRequest(input: Record<string, unknown>): MarketCandleRequestResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_CANDLE_REQUEST', message: 'Instrument, timeframe, from, and to are required.', details: parsed.error.flatten() };
  const instrument = parsed.data.instrument.toUpperCase();
  const timeframe = parsed.data.timeframe.toUpperCase();
  if (!isSupportedInstrument(instrument)) return { ok: false, code: 'INSTRUMENT_UNSUPPORTED', message: `${instrument} is not supported.` };
  if (!isMarketDataTimeframe(timeframe)) return { ok: false, code: 'TIMEFRAME_UNSUPPORTED', message: `${timeframe} is not supported.` };
  if (Date.parse(parsed.data.from) >= Date.parse(parsed.data.to)) return { ok: false, code: 'INVALID_CANDLE_RANGE', message: 'The candle range start must be before its end.' };
  return { ok: true, value: Object.freeze({ instrument, timeframe, from: parsed.data.from, to: parsed.data.to }) };
}
