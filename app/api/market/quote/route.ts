import { NextResponse } from 'next/server';
import { fetchPriceQuoteWithTelemetry } from '@/lib/market-data';
import { apiError, publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';
import { ProviderCreditLimitError, ProviderRequestReplayError, withTwelveDataCredits } from '@/lib/server/provider-credit-coordinator';
import { canUseInstrument, canonicalSymbol, catalogInstrumentFromRow } from '@/lib/instrument-catalog';
import { resolveInstrumentAccessContext } from '@/lib/server/instrument-access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);
    const idempotencyKey=request.headers.get('idempotency-key');
    if(!idempotencyKey||idempotencyKey.length>100)return apiError('IDEMPOTENCY_KEY_REQUIRED','A valid market-data request key is required.',400);

    const url = new URL(request.url);
    const instrument = canonicalSymbol(url.searchParams.get('instrument') ?? '');
    if (!instrument) return apiError('INVALID_INSTRUMENT', 'instrument is required.', 400);

    const { data: catalogRows, error: catalogError } = await supabase
      .from('instrument_catalog')
      .select('symbol,display_name,market_type,category,provider_symbol,exchange,country,base_currency,quote_currency,is_active,metadata')
      .eq('symbol', instrument)
      .eq('is_active', true)
      .limit(2);
    if (catalogError) throw catalogError;
    const catalogInstruments = (catalogRows ?? []).flatMap((row: any) => {
      const resolved = catalogInstrumentFromRow(row);
      return resolved ? [resolved] : [];
    });
    if (catalogInstruments.length !== 1) return apiError('INSTRUMENT_UNAVAILABLE', 'Instrument is unavailable or ambiguous.', 409);
    const catalogInstrument = catalogInstruments[0]!;
    const instrumentAccess = await resolveInstrumentAccessContext(supabase);
    if (!canUseInstrument(catalogInstrument, 'QUOTE', instrumentAccess)) {
      return apiError('INSTRUMENT_UNAVAILABLE', 'Live quotes are not available for this instrument.', 409);
    }

    const requestKey=`quote:${user.id}:${idempotencyKey}`;
    const { price, providerTimestamp, providerEventTimeMs, serverReceivedAt } = await withTwelveDataCredits({
      requestKey,
      operation: 'chart.quote',
      priority: 'BACKGROUND',
      credits: 1,
    },()=>fetchPriceQuoteWithTelemetry(instrument, catalogInstrument.providerSymbol));
    return NextResponse.json({
      instrument,
      provider: 'Twelve Data',
      price,
      providerTimestamp,
      providerEventTimeMs,
      serverReceivedAt,
      timestamp: providerEventTimeMs,
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof ProviderRequestReplayError) return apiError(error.code,error.message,409);
    if (error instanceof ProviderCreditLimitError) {
      return apiError('MARKET_QUOTE_CREDIT_WINDOW', 'Live chart is waiting for fresh market data.', 429, {
        retryAfterSeconds: error.reservation.retryAfterSeconds,
      });
    }
    return publicApiError({
      message: 'Current market price is temporarily unavailable.',
      code: 'MARKET_QUOTE_UNAVAILABLE',
      internalCode: 'MARKET_QUOTE_UNAVAILABLE',
      provider: 'twelvedata',
      endpoint: '/api/market/quote',
      error,
    });
  }
}
