import { NextResponse } from 'next/server';

import { catalogInstrumentFromRow, isMarketType } from '@/lib/instrument-catalog';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  const requestedMarket = url.searchParams.get('marketType');
  const marketType = requestedMarket && isMarketType(requestedMarket) ? requestedMarket : null;
  if (query.length < 1) return NextResponse.json({ instruments: [] }, { headers: { 'Cache-Control': 'private, no-store' } });

  const { data, error } = await supabase.rpc('search_instrument_catalog', {
    p_query: query,
    p_market_type: marketType,
    p_limit: 20,
  });
  if (error) {
    console.error('[INSTRUMENT_CATALOG_SEARCH_FAILED]', { message: error.message });
    return NextResponse.json({ error: 'Instrument catalog search failed.' }, { status: 503 });
  }

  const instruments = (data ?? []).flatMap((row: any) => {
    const instrument = catalogInstrumentFromRow(row);
    return instrument ? [instrument] : [];
  });
  return NextResponse.json({ instruments }, { headers: { 'Cache-Control': 'private, max-age=30' } });
}
