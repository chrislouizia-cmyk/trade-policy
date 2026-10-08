import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { apiError } from '@/lib/server/public-error';
import { getPublicMarketplaceListing } from '@/lib/server/public-marketplace';

export async function GET(_request: Request, context: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', 'Sign in to browse Marketplace.', 401);
  const listing = await getPublicMarketplaceListing(user.id, listingId);
  return listing ? NextResponse.json({ listing }) : apiError('NOT_FOUND', 'Marketplace strategy not found.', 404);
}

export async function POST(_request: Request, context: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', 'Sign in to install a strategy.', 401);
  const { data, error } = await supabase.rpc('install_public_marketplace_strategy', { p_listing_id: listingId });
  if (error) return apiError('INSTALL_FAILED', error.message, 400);
  return NextResponse.json({ ok: true, install: data }, { headers: { 'Cache-Control': 'no-store' } });
}
