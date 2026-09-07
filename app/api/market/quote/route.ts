import { NextResponse } from 'next/server';
import { fetchPriceQuote } from '@/lib/market-data';
import { apiError, publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

    const url = new URL(request.url);
    const instrument = (url.searchParams.get('instrument') ?? '').trim().toUpperCase();
    if (!instrument) return apiError('INVALID_INSTRUMENT', 'instrument is required.', 400);

    const { price, providerTimestamp, providerEventTimeMs, serverReceivedAt } = await fetchPriceQuote(instrument);
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
