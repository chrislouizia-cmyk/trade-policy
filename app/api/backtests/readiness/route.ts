import { NextResponse } from 'next/server';

import { buildHistoricalRulePlan } from '@/lib/backtesting/historical-rule-plan';
import { loadStrategyById } from '@/lib/server/active-strategy';
import { apiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

    const strategyProfileId = new URL(request.url).searchParams.get('strategyProfileId');
    if (!strategyProfileId) return apiError('INVALID_BACKTEST_READINESS_REQUEST', 'strategyProfileId is required.', 400);

    const strategy = await loadStrategyById(supabase, user.id, strategyProfileId);
    const plan = buildHistoricalRulePlan(strategy);
    return NextResponse.json({
      ready: plan.unsupportedRequiredRules.length === 0,
      executableRuleCount: plan.rules.length,
      unsupportedRules: plan.unsupportedRules,
      unsupportedRequiredRules: plan.unsupportedRequiredRules,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError('BACKTEST_READINESS_FAILED', error instanceof Error ? error.message : 'Backtest readiness could not be determined.', 500);
  }
}
