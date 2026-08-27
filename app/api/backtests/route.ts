import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createBacktestRun, freezeStrategyForBacktest, getBacktestPlanCodeForUser } from '@/lib/server/backtesting';
import { apiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const schema = z.object({
  strategyProfileId: z.string().uuid(),
  workspaceId: z.string().uuid().nullable().optional(),
  instrument: z.string().min(1).default('XAUUSD'),
  executionTimeframe: z.string().min(1).default('M15'),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  startingBalance: z.coerce.number().positive(),
  riskConfiguration: z.record(z.string(), z.unknown()).optional().default({}),
  executionModel: z.record(z.string(), z.unknown()).optional().default({}),
  engineVersion: z.string().default('1.0.0'),
  dataProvider: z.string().default('Twelve Data'),
  dataRevisionFingerprint: z.string().default(''),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  idempotencyKey: z.string().trim().min(1).max(160).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return apiError('UNAUTHORIZED', 'Unauthorized.', 401);
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return apiError('INVALID_BACKTEST_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid backtest request.', 400, parsed.error.flatten());
    }

    const payload = parsed.data;
    const { data: strategy, error: strategyError } = await supabase
      .from('strategy_profiles')
      .select('*')
      .eq('id', payload.strategyProfileId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (strategyError) {
      return apiError('STRATEGY_LOOKUP_FAILED', strategyError.message, 500);
    }

    if (!strategy) {
      return apiError('STRATEGY_NOT_FOUND', 'Strategy not found or not owned by this user.', 404);
    }

    const frozen = freezeStrategyForBacktest(strategy as any);
    const planCode = await getBacktestPlanCodeForUser(user.id);

    const run = await createBacktestRun({
      userId: user.id,
      workspaceId: payload.workspaceId ?? null,
      strategyProfileId: payload.strategyProfileId,
      strategyRevisionId: frozen.strategyRevisionId,
      strategySnapshotHash: frozen.strategySnapshotHash,
      strategySnapshotJson: frozen.strategySnapshotJson,
      instrument: payload.instrument,
      executionTimeframe: payload.executionTimeframe,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      startingBalance: payload.startingBalance,
      riskConfiguration: payload.riskConfiguration,
      executionModel: payload.executionModel,
      engineVersion: payload.engineVersion,
      dataProvider: payload.dataProvider,
      dataRevisionFingerprint: payload.dataRevisionFingerprint,
      metadata: payload.metadata,
      planCode,
      idempotencyKey: payload.idempotencyKey ?? null,
    });

    return NextResponse.json({
      runId: run.id,
      status: run.status,
      strategyRevisionId: run.strategy_revision_id,
      strategySnapshotHash: run.strategy_snapshot_hash,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backtest could not be created.';
    if (message.toLowerCase().includes('quota exceeded')) {
      return apiError('BACKTEST_LIMIT_REACHED', message, 429);
    }
    return apiError('BACKTEST_CREATION_FAILED', message, 500);
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return apiError('UNAUTHORIZED', 'Unauthorized.', 401);
    }

    const { data, error } = await supabase
      .from('backtest_runs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return apiError('BACKTEST_READ_FAILED', error.message, 500);
    }

    return NextResponse.json({ items: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError('BACKTEST_READ_FAILED', error instanceof Error ? error.message : 'Backtest list could not be loaded.', 500);
  }
}
