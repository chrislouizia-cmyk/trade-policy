import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { apiError } from '@/lib/server/public-error';
import { getPublicMarketplace } from '@/lib/server/public-marketplace';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', 'Sign in to browse Marketplace.', 401);
  try {
    return NextResponse.json({ listings: await getPublicMarketplace(user.id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[PUBLIC_MARKETPLACE_LIST]', error);
    return apiError('MARKETPLACE_UNAVAILABLE', 'Marketplace is temporarily unavailable.', 503);
  }
}
