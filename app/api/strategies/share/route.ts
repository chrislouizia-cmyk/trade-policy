import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const strategySchema = z.object({ strategyId: z.string().uuid() });
const revokeSchema = z.object({ shareId: z.string().uuid() });

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return { supabase, user: error ? null : user };
}

export async function GET(request: Request) {
  const { supabase, user } = await authenticatedClient();
  if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

  const parsed = strategySchema.safeParse({
    strategyId: new URL(request.url).searchParams.get('strategyId'),
  });
  if (!parsed.success) return apiError('INVALID_STRATEGY', 'A valid strategy is required.', 400);

  const { data: share, error } = await supabase
    .from('strategy_shares')
    .select('id,share_code,status,current_version,license_code,created_at,updated_at,revoked_at')
    .eq('owner_user_id', user.id)
    .eq('source_strategy_id', parsed.data.strategyId)
    .maybeSingle();

  if (error) return apiError('SHARE_LOOKUP_FAILED', error.message, 500);
  if (!share) return NextResponse.json({ share: null }, { headers: { 'Cache-Control': 'no-store' } });

  const { count, error: countError } = await supabase
    .from('strategy_share_installs')
    .select('id', { count: 'exact', head: true })
    .eq('share_id', share.id);
  if (countError) return apiError('SHARE_INSTALL_COUNT_FAILED', countError.message, 500);

  return NextResponse.json({
    share: {
      id: share.id,
      shareCode: share.share_code,
      status: share.status,
      currentVersion: share.current_version,
      licenseCode: share.license_code,
      installCount: count ?? 0,
      createdAt: share.created_at,
      updatedAt: share.updated_at,
      revokedAt: share.revoked_at,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const { supabase, user } = await authenticatedClient();
  if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);
  const parsed = strategySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('INVALID_STRATEGY', 'A valid strategy is required.', 400);

  const { data, error } = await supabase.rpc('publish_strategy_share_v1', {
    p_strategy_id: parsed.data.strategyId,
  });
  if (error) return apiError('SHARE_PUBLISH_FAILED', error.message, 500);
  return NextResponse.json({ share: data }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: Request) {
  const { supabase, user } = await authenticatedClient();
  if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);
  const parsed = revokeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('INVALID_SHARE', 'A valid share is required.', 400);

  const { data, error } = await supabase.rpc('revoke_strategy_share_v1', {
    p_share_id: parsed.data.shareId,
  });
  if (error) return apiError('SHARE_REVOKE_FAILED', error.message, 500);
  return NextResponse.json({ share: data }, { headers: { 'Cache-Control': 'no-store' } });
}
