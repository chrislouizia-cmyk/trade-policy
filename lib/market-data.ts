import type { Candle } from '@/lib/market-analysis';

const intervalMap: Record<string, string> = {
  M1: '1min', M3: '3min', M5: '5min', M15: '15min', M30: '30min',
  H1: '1h', H2: '2h', H4: '4h', H6: '6h', H8: '8h', H12: '12h',
  D1: '1day', W1: '1week', MN: '1month',
};

export function providerSymbol(symbol: string): string {
  const clean = symbol.trim().toUpperCase();
  if (/^[A-Z]{6}$/.test(clean)) return `${clean.slice(0, 3)}/${clean.slice(3)}`;
  return clean;
}

async function request(params: Record<string, string>) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error('TWELVE_DATA_API_KEY is not configured.');
  const url = new URL('https://api.twelvedata.com/' + params.endpoint);
  Object.entries(params).forEach(([keyName, value]) => {
    if (keyName !== 'endpoint') url.searchParams.set(keyName, value);
  });
  url.searchParams.set('apikey', key);
  const response = await fetch(url, { cache: 'no-store' });
  const json = await response.json();
  if (!response.ok || json.status === 'error' || json.code) {
    throw new Error(json.message || 'Market-data request failed.');
  }
  return json;
}

export async function fetchSeries(symbol: string, timeframe: string, outputsize = 120): Promise<Candle[]> {
  if (!intervalMap[timeframe]) throw new Error(`Unsupported market-data timeframe: ${timeframe}.`);
  const json = await request({
    endpoint: 'time_series', symbol: providerSymbol(symbol),
    interval: intervalMap[timeframe],
    outputsize: String(outputsize), order: 'ASC',
  });
  if (!Array.isArray(json.values)) throw new Error(`No market data returned for ${symbol} ${timeframe}.`);
  return json.values.map((item: any) => ({
    datetime: item.datetime, open: Number(item.open), high: Number(item.high),
    low: Number(item.low), close: Number(item.close),
    volume: item.volume == null ? undefined : Number(item.volume),
  }));
}

export async function fetchPrice(symbol: string): Promise<number> {
  const json = await request({ endpoint: 'price', symbol: providerSymbol(symbol) });
  const price = Number(json.price);
  if (!Number.isFinite(price)) throw new Error(`No current price returned for ${symbol}.`);
  return price;
}
