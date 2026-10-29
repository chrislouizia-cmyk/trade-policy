import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { getHQMarketplaceContext } from '@/lib/server/hq-marketplace';
import { syncTwelveDataInstrumentMarket } from '@/lib/server/instrument-catalog-sync';

export const dynamic = 'force-dynamic';

const schema = z.object({
  market: z.enum(['FOREX', 'STOCKS', 'ETFS', 'CRYPTO', 'COMMODITIES']),
});

export async function POST(request: Request) {
  try {
    await getHQMarketplaceContext();
    const supabase = await createClient();
    const { data: isOwner, error: permissionError } = await supabase.rpc('is_owner');
    if (permissionError || !isOwner) return NextResponse.json({ error: 'Founder permission required.' }, { status: 403 });

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'A supported market is required.' }, { status: 400 });

    const result = await syncTwelveDataInstrumentMarket(parsed.data.market);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[INSTRUMENT_CATALOG_SYNC_FAILED]', { message: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Instrument catalog synchronization failed.' }, { status: 503 });
  }
}
