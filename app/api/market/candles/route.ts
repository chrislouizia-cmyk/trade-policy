import { NextResponse } from 'next/server';
import { parseMarketCandleRequest } from '@/lib/market-candle-request';
import { fetchSeriesRangeWithTelemetry, MarketDataProviderError } from '@/lib/market-data';
import { apiError, publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';
import {withTwelveDataCredits,ProviderCreditLimitError} from '@/lib/server/provider-credit-coordinator';

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
    const requestKey=`candles:${user.id}:${instrument}:${timeframe}:${from}:${to}`;
    const candles = await withTwelveDataCredits({requestKey,operation:'chart.candles',priority:'INTERACTIVE',credits:1},()=>fetchSeriesRangeWithTelemetry(instrument,timeframe,from,to));
    return NextResponse.json({ instrument, timeframe, from, to, provider: 'Twelve Data', candles }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if(error instanceof ProviderCreditLimitError)return apiError(error.reservation.retryAfterSeconds>65?'MARKET_DATA_DAILY_REST':'MARKET_DATA_CREDIT_WINDOW',error.reservation.retryAfterSeconds>65?"Market data has reached today's safe capacity. It will return after the daily refresh.":'Market data is refreshing. Please try again in a moment.',429,{retryAfterSeconds:error.reservation.retryAfterSeconds,dailyResetsAt:error.reservation.dailyResetsAt});
    if(error instanceof MarketDataProviderError&&error.code==='RATE_LIMITED')return apiError(error.limitScope==='DAILY'?'MARKET_DATA_DAILY_REST':'MARKET_DATA_RATE_LIMITED',error.limitScope==='DAILY'?"Market data has reached today's safe capacity. It will return after the daily refresh.":'Market data is refreshing. Please try again in a moment.',429,{retryAfterSeconds:error.retryAfterSeconds,dailyResetsAt:error.dailyResetsAt});
    return publicApiError({ message: 'Market candles are temporarily unavailable.', code: 'MARKET_CANDLES_UNAVAILABLE', internalCode: 'MARKET_CANDLES_UNAVAILABLE', provider: 'twelvedata', endpoint: '/api/market/candles', error });
  }
}
