import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { apiError } from '@/lib/server/public-error';

const schema = z.object({
  strategyId: z.string().uuid(),
  confirmation: z.literal('DELETE'),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return apiError('UNAUTHORIZED', 'Unauthorized.', 401);
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('DELETE_CONFIRMATION_REQUIRED', 'Type DELETE to confirm strategy deletion.', 400);
  }

  const { strategyId } = parsed.data;

  const { data: existing, error: lookupError } = await supabase
    .from('strategy_profiles')
    .select('id,user_id,is_archived,is_default,created_at')
    .eq('id', strategyId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (lookupError) {
    return apiError('STRATEGY_LOOKUP_FAILED', lookupError.message, 500);
  }

  if (!existing) {
    return apiError('STRATEGY_NOT_FOUND', 'Strategy not found or not owned by this user.', 404);
  }

  if (existing.is_archived) {
    return NextResponse.json({
      ok: true,
      strategyId,
      archived: true,
      alreadyArchived: true,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const fallbackTarget = await supabase
    .from('strategy_profiles')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_archived', false)
    .neq('id', strategyId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { error: archiveError } = await supabase
    .from('strategy_profiles')
    .update({
      is_archived: true,
      is_default: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', strategyId)
    .eq('user_id', user.id);

  if (archiveError) {
    return apiError('STRATEGY_ARCHIVE_FAILED', archiveError.message, 500);
  }

  if (fallbackTarget.data?.id && existing.is_default) {
    const { error: activateNextError } = await supabase
      .from('strategy_profiles')
      .update({
        is_default: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fallbackTarget.data.id)
      .eq('user_id', user.id)
      .eq('is_archived', false);

    if (activateNextError) {
      return apiError('STRATEGY_FALLBACK_FAILED', activateNextError.message, 500);
    }
  }

  return NextResponse.json({
    ok: true,
    strategyId,
    archived: true,
    alreadyArchived: false,
    fallbackStrategyId: fallbackTarget.data?.id ?? null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
