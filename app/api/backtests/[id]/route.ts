import { NextResponse } from 'next/server';
import { apiError } from '@/lib/server/public-error';
import { getBacktestRunForUser } from '@/lib/server/backtesting';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return apiError('UNAUTHORIZED', 'Unauthorized.', 401);
    }

    const { id } = await context.params;
    const run = await getBacktestRunForUser(user.id, id);

    if (!run) {
      return apiError('BACKTEST_NOT_FOUND', 'Backtest run not found.', 404);
    }

    return NextResponse.json(run, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError('BACKTEST_READ_FAILED', error instanceof Error ? error.message : 'Backtest run could not be loaded.', 500);
  }
}
