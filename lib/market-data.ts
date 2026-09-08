import type { Candle } from '@/lib/market-analysis';

const MARKET_DATA_TIMEOUT_MS = 12_000;
export type ProviderCreditTelemetry={creditsUsed:number|null;creditsLeft:number|null;requestCredits:number|null;observedAt:string};
export type ProviderResult<T>={value:T;telemetry:ProviderCreditTelemetry};
export class MarketDataProviderError extends Error{
  code:'RATE_LIMITED'|'PROVIDER_REJECTED'|'UNREACHABLE'|'TIMEOUT'|'INVALID_RESPONSE';
  retryAfterSeconds:number|null;
  limitScope:'MINUTE'|'DAILY'|null;
  dailyResetsAt:string|null;
  telemetry:ProviderCreditTelemetry|null;
  constructor(code:'RATE_LIMITED'|'PROVIDER_REJECTED'|'UNREACHABLE'|'TIMEOUT'|'INVALID_RESPONSE',message:string,retryAfterSeconds:number|null=null,limitScope:'MINUTE'|'DAILY'|null=null,dailyResetsAt:string|null=null,telemetry:ProviderCreditTelemetry|null=null){super(message);this.name='MarketDataProviderError';this.code=code;this.retryAfterSeconds=retryAfterSeconds;this.limitScope=limitScope;this.dailyResetsAt=dailyResetsAt;this.telemetry=telemetry;}
}
export const isTwelveDataRateLimit=(status:number,message:string)=>status===429||/api credit|credits|current minute|rate limit|too many requests/i.test(message);
export const isTwelveDataDailyLimit=(message:string)=>/daily|per day|today|current day|for the day|day limit|until (?:the )?next day/i.test(message);

export function twelveDataLimitWindow(message:string,now=new Date()):{scope:'MINUTE'|'DAILY';retryAfterSeconds:number;dailyResetsAt:string|null}{
  if(isTwelveDataDailyLimit(message)){
    const nextUtcDay=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1));
    return{scope:'DAILY',retryAfterSeconds:Math.max(1,Math.ceil((nextUtcDay.getTime()-now.getTime())/1000)),dailyResetsAt:nextUtcDay.toISOString()};
  }
  return{scope:'MINUTE',retryAfterSeconds:60,dailyResetsAt:null};
}

export const MARKET_DATA_INTERVALS = Object.freeze({
  M1: '1min', M3: '3min', M5: '5min', M15: '15min', M30: '30min',
  H1: '1h', H2: '2h', H4: '4h', H6: '6h', H8: '8h', H12: '12h',
  D1: '1day', W1: '1week', MN: '1month',
} as const);

export function isMarketDataTimeframe(value: string): value is keyof typeof MARKET_DATA_INTERVALS {
  return value in MARKET_DATA_INTERVALS;
}

export function providerSymbol(symbol: string): string {
  const clean = symbol.trim().toUpperCase();
  if (/^[A-Z]{6}$/.test(clean)) return `${clean.slice(0, 3)}/${clean.slice(3)}`;
  return clean;
}

const headerCredit=(response:Response,name:string)=>{const value=response.headers.get(name);if(value==null)return null;const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:null;};
export const extractProviderCreditTelemetry=(response:Response):ProviderCreditTelemetry=>({
  creditsUsed:headerCredit(response,'api-credits-used'),creditsLeft:headerCredit(response,'api-credits-left'),
  requestCredits:headerCredit(response,'api-credits-request'),observedAt:new Date().toISOString(),
});

async function request(params: Record<string, string>):Promise<ProviderResult<any>> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error('TWELVE_DATA_API_KEY is not configured.');
  const url = new URL('https://api.twelvedata.com/' + params.endpoint);
  Object.entries(params).forEach(([keyName, value]) => {
    if (keyName !== 'endpoint') url.searchParams.set(keyName, value);
  });
  url.searchParams.set('apikey', key);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MARKET_DATA_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MarketDataProviderError('TIMEOUT','Market-data provider timed out.');
    }
    throw new MarketDataProviderError('UNREACHABLE','Market-data provider is unreachable.');
  } finally {
    clearTimeout(timeout);
  }
  const telemetry=extractProviderCreditTelemetry(response);
  let json: any;
  try {
    json = await response.json();
  } catch {
    throw new MarketDataProviderError('INVALID_RESPONSE','Market-data provider returned an invalid response.',null,null,null,telemetry);
  }
  if (!response.ok || json.status === 'error' || json.code) {
    const message=String(json.message||'Market-data request failed.');
    if(isTwelveDataRateLimit(response.status,message)){
      const limit=twelveDataLimitWindow(message);
      throw new MarketDataProviderError('RATE_LIMITED',message,limit.retryAfterSeconds,limit.scope,limit.dailyResetsAt,telemetry);
    }
    throw new MarketDataProviderError('PROVIDER_REJECTED',message,null,null,null,telemetry);
  }
  return{value:json,telemetry};
}

export function normalizeProviderEventTimeMs(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const absolute = Math.abs(value);
    if (absolute > 1e14) return null;
    if (absolute >= 1e12) return value;
    if (absolute >= 1e9 && absolute < 1e12) return value * 1000;
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric)) return null;
      const absolute = Math.abs(numeric);
      if (absolute > 1e14) return null;
      if (absolute >= 1e12) return numeric;
      if (absolute >= 1e9 && absolute < 1e12) return numeric * 1000;
      return null;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  }
  return null;
}

export function extractProviderEventTimeMs(payload: Record<string, unknown>): number | null {
  const candidate = payload.timestamp ?? payload.datetime ?? payload.time ?? payload.last_updated ?? payload.epoch ?? payload.ts ?? null;
  return normalizeProviderEventTimeMs(candidate);
}

export function extractProviderPrice(payload: Record<string, unknown>): number | null {
  const candidate = payload.price ?? payload.close ?? payload.last ?? payload.value ?? payload.current_price ?? payload.current ?? null;
  if (candidate == null || candidate === '') return null;
  const price = Number(candidate);
  return Number.isFinite(price) ? price : null;
}

export async function fetchSeries(symbol: string, timeframe: string, outputsize = 120): Promise<Candle[]> {
  return (await fetchSeriesWithTelemetry(symbol,timeframe,outputsize)).value;
}
export async function fetchSeriesWithTelemetry(symbol: string, timeframe: string, outputsize = 120): Promise<ProviderResult<Candle[]>> {
  if (!isMarketDataTimeframe(timeframe)) throw new Error(`Unsupported market-data timeframe: ${timeframe}.`);
  const result = await request({
    endpoint: 'time_series', symbol: providerSymbol(symbol),
    interval: MARKET_DATA_INTERVALS[timeframe],
    outputsize: String(outputsize), order: 'ASC',
  });
  const json=result.value;
  if (!Array.isArray(json.values) || json.values.length === 0) throw new Error(`No market data returned for ${symbol} ${timeframe}.`);
  return{value:normalizeTwelveDataCandles(json.values, symbol, timeframe),telemetry:result.telemetry};
}

export function normalizeTwelveDataCandles(values: unknown[], symbol = 'instrument', timeframe = 'timeframe'): Candle[] {
  const candles = values.map((value) => {
    const item = value as Record<string, unknown>;
    const timestamp = String(item.datetime ?? '').trim().replace(' ', 'T');
    const datetime = timestamp && Number.isFinite(Date.parse(timestamp.endsWith('Z') ? timestamp : `${timestamp}Z`))
      ? new Date(Date.parse(timestamp.endsWith('Z') ? timestamp : `${timestamp}Z`)).toISOString()
      : '';
    return { datetime, open: Number(item.open), high: Number(item.high),
    low: Number(item.low), close: Number(item.close),
    volume: item.volume == null ? undefined : Number(item.volume),
    };
  });
  const malformed = candles.some((candle: Candle) =>
    typeof candle.datetime !== 'string' || !candle.datetime
    || ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
    || candle.high < Math.max(candle.open, candle.close, candle.low)
    || candle.low > Math.min(candle.open, candle.close, candle.high)
    || (candle.volume !== undefined && !Number.isFinite(candle.volume))
  );
  if (malformed) throw new Error(`Market data for ${symbol} ${timeframe} is malformed.`);
  return candles;
}

export async function fetchSeriesRange(symbol: string, timeframe: string, from: string, to: string): Promise<Candle[]> {
  return (await fetchSeriesRangeWithTelemetry(symbol,timeframe,from,to)).value;
}
export async function fetchSeriesRangeWithTelemetry(symbol: string, timeframe: string, from: string, to: string): Promise<ProviderResult<Candle[]>> {
  if (!isMarketDataTimeframe(timeframe)) throw new Error(`Unsupported market-data timeframe: ${timeframe}.`);
  const result = await request({
    endpoint: 'time_series', symbol: providerSymbol(symbol), interval: MARKET_DATA_INTERVALS[timeframe],
    start_date: new Date(from).toISOString(), end_date: new Date(to).toISOString(), outputsize: '5000', order: 'ASC', timezone: 'UTC',
  });
  const json=result.value;
  if (!Array.isArray(json.values) || json.values.length === 0) throw new Error(`No market data returned for ${symbol} ${timeframe}.`);
  return{value:normalizeTwelveDataCandles(json.values, symbol, timeframe),telemetry:result.telemetry};
}

export async function fetchPriceQuote(symbol: string): Promise<{ price: number; providerTimestamp: string | null; providerEventTimeMs: number | null; serverReceivedAt: string; raw: Record<string, unknown> }> {
  return (await fetchPriceQuoteWithTelemetry(symbol)).value;
}
export async function fetchPriceQuoteWithTelemetry(symbol: string):Promise<ProviderResult<{ price: number; providerTimestamp: string | null; providerEventTimeMs: number | null; serverReceivedAt: string; raw: Record<string, unknown> }>>{
  const result = await request({ endpoint: 'quote', symbol: providerSymbol(symbol) });
  const json=result.value;
  const payload = json as Record<string, unknown>;
  const price = extractProviderPrice(payload);
  if (price == null) throw new Error(`No live price returned for ${symbol}.`);
  const providerEventTimeMs = extractProviderEventTimeMs(payload);
  if (providerEventTimeMs == null) throw new Error(`Live quote for ${symbol} does not include a valid provider event timestamp.`);
  const providerTimestamp = new Date(providerEventTimeMs).toISOString();
  return {value:{ price, providerTimestamp, providerEventTimeMs, serverReceivedAt: new Date().toISOString(), raw: payload },telemetry:result.telemetry};
}

export async function fetchPrice(symbol: string): Promise<number> {
  const { price } = await fetchPriceQuote(symbol);
  return price;
}
export async function fetchPriceWithTelemetry(symbol:string):Promise<ProviderResult<number>>{const result=await fetchPriceQuoteWithTelemetry(symbol);return{value:result.value.price,telemetry:result.telemetry};}
