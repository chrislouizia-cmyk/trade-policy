import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { apiError } from '@/lib/server/public-error';

const schema = z.object({
  strategyId: z.string().uuid(),
  confirmation: z.literal('DELETE'),
});

type DeleteStrategyResult = {
  deleted?: boolean;
  strategyId?: string;
  fallbackStrategyId?: string | null;
  detachedTradeRecords?: number;
  detachedActiveTrades?: number;
  detachedMarketScans?: number;
};

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
    .select('id,user_id,name,is_default')
    .eq('id', strategyId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (lookupError) {
    return apiError('STRATEGY_LOOKUP_FAILED', lookupError.message, 500);
  }

  if (!existing) {
    return apiError('STRATEGY_NOT_FOUND', 'Strategy not found or not owned by this user.', 404);
  }

  const { data, error } = await supabase.rpc('delete_strategy_playbook', {
    p_strategy_id: strategyId,
  });

  if (error) {
    return apiError('STRATEGY_DELETE_FAILED', error.message, 500);
  }

  const result = (data ?? {}) as DeleteStrategyResult;
  if (result.deleted !== true || result.strategyId !== strategyId) {
    return apiError('STRATEGY_DELETE_INCOMPLETE', 'Strategy deletion did not complete.', 500);
  }

  return NextResponse.json({
    ok: true,
    deleted: true,
    strategyId,
    fallbackStrategyId: result.fallbackStrategyId ?? null,
    detachedTradeRecords: result.detachedTradeRecords ?? 0,
    detachedActiveTrades: result.detachedActiveTrades ?? 0,
    detachedMarketScans: result.detachedMarketScans ?? 0,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
