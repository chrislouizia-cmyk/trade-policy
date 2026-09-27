import { NextResponse } from 'next/server';
import { parseMarketCandleRequest } from '@/lib/market-candle-request';
import { fetchSeriesRangeWithTelemetry, MarketDataProviderError } from '@/lib/market-data';
import { apiError, publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';
import {withTwelveDataCredits,ProviderCreditLimitError,ProviderRequestReplayError} from '@/lib/server/provider-credit-coordinator';
import {canUseInstrument,canonicalSymbol,catalogInstrumentFromRow} from '@/lib/instrument-catalog';
import {resolveInstrumentAccessContext} from '@/lib/server/instrument-access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);
    const idempotencyKey=request.headers.get('idempotency-key');
    if(!idempotencyKey||idempotencyKey.length>100)return apiError('IDEMPOTENCY_KEY_REQUIRED','A valid market-data request key is required.',400);
    const url = new URL(request.url);
    const parsed = parseMarketCandleRequest(Object.fromEntries(url.searchParams), { deferInstrumentValidation: true });
    if (!parsed.ok) return apiError(parsed.code, parsed.message, 400, parsed.details);
    const { timeframe, from, to } = parsed.value;
    const instrument=canonicalSymbol(parsed.value.instrument);
    const strategyId=url.searchParams.get('strategyId');
    if(!strategyId)return apiError('STRATEGY_CONTEXT_REQUIRED','A strategy is required to resolve this instrument.',400);
    const {data:strategyInstrumentRows,error:strategyInstrumentError}=await supabase.from('strategy_instruments')
      .select('symbol,market_type,provider_symbol').eq('strategy_id',strategyId).eq('user_id',user.id)
      .eq('symbol',instrument).eq('enabled',true).limit(2);
    if(strategyInstrumentError)throw strategyInstrumentError;
    if(strategyInstrumentRows?.length!==1)return apiError('INSTRUMENT_AMBIGUOUS','The strategy instrument is missing or ambiguous.',409);
    const strategyInstrument=strategyInstrumentRows[0]!;
    const instrumentAccess=await resolveInstrumentAccessContext(supabase);
    const {data:catalogRow,error:catalogError}=await supabase.from('instrument_catalog')
      .select('symbol,display_name,market_type,category,provider_symbol,exchange,country,base_currency,quote_currency,is_active,metadata')
      .eq('symbol',instrument).eq('market_type',strategyInstrument.market_type).eq('is_active',true).maybeSingle();
    if(catalogError)throw catalogError;
    const catalogInstrument=catalogRow?catalogInstrumentFromRow(catalogRow as any):null;
    if(!catalogInstrument||!canUseInstrument(catalogInstrument,'HISTORICAL',instrumentAccess))return apiError('INSTRUMENT_UNSUPPORTED',`${instrument} is not available for historical charts.`,409);
    const requestKey=`candles:${user.id}:${idempotencyKey}`;
    const candles = await withTwelveDataCredits({requestKey,operation:'chart.candles',priority:'INTERACTIVE',credits:1},()=>fetchSeriesRangeWithTelemetry(instrument,timeframe,from,to,catalogInstrument.providerSymbol));
    return NextResponse.json({ instrument, timeframe, from, to, provider: 'Twelve Data', candles }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if(error instanceof ProviderRequestReplayError)return apiError(error.code,error.message,409);
    if(error instanceof ProviderCreditLimitError)return apiError(error.reservation.retryAfterSeconds>65?'MARKET_DATA_DAILY_REST':'MARKET_DATA_CREDIT_WINDOW',error.reservation.retryAfterSeconds>65?"Market data has reached today's safe capacity. It will return after the daily refresh.":'Market data is refreshing. Please try again in a moment.',429,{retryAfterSeconds:error.reservation.retryAfterSeconds,dailyResetsAt:error.reservation.dailyResetsAt});
    if(error instanceof MarketDataProviderError&&error.code==='RATE_LIMITED')return apiError(error.limitScope==='DAILY'?'MARKET_DATA_DAILY_REST':'MARKET_DATA_RATE_LIMITED',error.limitScope==='DAILY'?"Market data has reached today's safe capacity. It will return after the daily refresh.":'Market data is refreshing. Please try again in a moment.',429,{retryAfterSeconds:error.retryAfterSeconds,dailyResetsAt:error.dailyResetsAt});
    return publicApiError({ message: 'Market candles are temporarily unavailable.', code: 'MARKET_CANDLES_UNAVAILABLE', internalCode: 'MARKET_CANDLES_UNAVAILABLE', provider: 'twelvedata', endpoint: '/api/market/candles', error });
  }
}
