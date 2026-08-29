import { NextResponse } from 'next/server';
import { parseMarketCandleRequest } from '@/lib/market-candle-request';
import { fetchSeriesRange } from '@/lib/market-data';
import { apiError, publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);
    const url = new URL(request.url);
    const parsed = parseMarketCandleRequest(Object.fromEntries(url.searchParams));
    if (!parsed.ok) return apiError(parsed.code, parsed.message, 400, parsed.details);
    const { instrument, timeframe, from, to } = parsed.value;
    const candles = await fetchSeriesRange(instrument, timeframe, from, to);
    return NextResponse.json({ instrument, timeframe, from, to, provider: 'Twelve Data', candles }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return publicApiError({ message: 'Market candles are temporarily unavailable.', code: 'MARKET_CANDLES_UNAVAILABLE', internalCode: 'MARKET_CANDLES_UNAVAILABLE', provider: 'twelvedata', endpoint: '/api/market/candles', error });
  }
}
