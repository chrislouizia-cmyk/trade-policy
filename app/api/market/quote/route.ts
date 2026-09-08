import { NextResponse } from 'next/server';
import { fetchPriceQuoteWithTelemetry } from '@/lib/market-data';
import { apiError, publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';
import { ProviderCreditLimitError, withTwelveDataCredits } from '@/lib/server/provider-credit-coordinator';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

    const url = new URL(request.url);
    const instrument = (url.searchParams.get('instrument') ?? '').trim().toUpperCase();
    if (!instrument) return apiError('INVALID_INSTRUMENT', 'instrument is required.', 400);

    const requestKey=`quote:${user.id}:${instrument}:${request.headers.get('idempotency-key') ?? Date.now()}`;
    const { price, providerTimestamp, providerEventTimeMs, serverReceivedAt } = await withTwelveDataCredits({
      requestKey,
      operation: 'chart.quote',
      priority: 'BACKGROUND',
      credits: 1,
    },()=>fetchPriceQuoteWithTelemetry(instrument));
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
