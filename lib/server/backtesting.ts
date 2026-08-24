import 'server-only';

import { serverEntitlementOverride } from '@/lib/billing/overrides';
import { getAnchoredMonthlyPeriod } from '@/lib/billing/period';
import { createAdminClient } from '@/lib/supabase/admin';
import { strategyRevisionId } from '@/lib/historical-decisions/strategy-revision';
import { stableFingerprint } from '@/lib/market-intelligence/serialization/stable-fingerprint';
import type { BacktestRun, BacktestRunStatus, BacktestUsage } from '@/types/backtesting';
import type { StrategyProfile } from '@/types/trade';

export const BACKTEST_PLAN_LIMITS = {
  FREE: 0,
  PRO: 3,
  ELITE: 10,
  TEAM: 70,
  FOUNDER: null,
} as const;

export type BacktestPlanCode = keyof typeof BACKTEST_PLAN_LIMITS;

export function resolveBacktestPlanLimit(planCode: string | null | undefined): number | null {
  const normalized = String(planCode ?? 'FREE').trim().toUpperCase();
  return normalized in BACKTEST_PLAN_LIMITS ? BACKTEST_PLAN_LIMITS[normalized as BacktestPlanCode] : 0;
}

export function freezeStrategyForBacktest(strategy: StrategyProfile) {
  const revisionId = strategyRevisionId(strategy);
  const fingerprint = stableFingerprint({ strategy });
  return {
    strategyRevisionId: revisionId,
    strategySnapshotHash: fingerprint,
    strategySnapshotJson: JSON.parse(JSON.stringify(strategy)),
  };
}

export function getBacktestPeriod(now: Date = new Date()) {
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    start,
    end,
    startKey: start.toISOString().slice(0, 10),
    endKey: end.toISOString().slice(0, 10),
  };
}

export async function ensureBacktestUsageRow(
  userId: string,
  workspaceId: string | null | undefined,
  planCode: string,
  now: Date = new Date(),
) {
  const admin = createAdminClient();
  const period = getBacktestPeriod(now);
  const limit = resolveBacktestPlanLimit(planCode);

  const { data: row, error } = await admin
    .from('backtest_usage')
    .upsert({
      user_id: userId,
      workspace_id: workspaceId ?? null,
      plan_code: String(planCode).toUpperCase(),
      billing_period_start: period.startKey,
      billing_period_end: period.endKey,
      run_count: 0,
      limit_value: limit ?? 0,
      last_run_id: null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,workspace_id,plan_code,billing_period_start',
      ignoreDuplicates: false,
    })
    .select('*')
    .single();

  if (error || !row) {
    throw new Error(`Backtest quota could not be initialized. ${error?.message ?? ''}`.trim());
  }

  return row as BacktestUsage;
}

export async function checkBacktestQuota(
  userId: string,
  workspaceId: string | null | undefined,
  planCode: string,
  now: Date = new Date(),
) {
  const admin = createAdminClient();
  const period = getBacktestPeriod(now);
  const limit = resolveBacktestPlanLimit(planCode);

  const normalizedPlanCode = String(planCode).toUpperCase();
  const { data: row, error } = await admin
    .from('backtest_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_code', normalizedPlanCode)
    .eq('billing_period_start', period.startKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Backtest quota lookup failed. ${error.message}`);
  }

  const usage = row ?? (await ensureBacktestUsageRow(userId, workspaceId, planCode, now));

  return {
    allowed: limit === null || (Number(usage.run_count ?? 0) < Number(limit)),
    usage: usage as BacktestUsage,
    limit,
  };
}

export async function createBacktestRun(input: {
  userId: string;
  workspaceId?: string | null;
  strategyProfileId: string;
  strategyRevisionId: string;
  strategySnapshotHash: string;
  strategySnapshotJson: Record<string, unknown>;
  instrument: string;
  executionTimeframe: string;
  periodStart: string;
  periodEnd: string;
  startingBalance: number;
  riskConfiguration?: Record<string, unknown>;
  executionModel?: Record<string, unknown>;
  engineVersion?: string;
  dataProvider?: string;
  dataRevisionFingerprint?: string;
  metadata?: Record<string, unknown>;
  planCode?: string;
}) {
  const admin = createAdminClient();
  const planCode = String(input.planCode ?? 'FREE').toUpperCase();
  const quota = await checkBacktestQuota(input.userId, input.workspaceId ?? null, planCode);

  if (!quota.allowed) {
    throw new Error(`Backtest quota exceeded for plan ${planCode}.`);
  }

  const { data: run, error: runError } = await admin
    .from('backtest_runs')
    .insert({
      user_id: input.userId,
      workspace_id: input.workspaceId ?? null,
      strategy_profile_id: input.strategyProfileId,
      strategy_revision_id: input.strategyRevisionId,
      strategy_snapshot_hash: input.strategySnapshotHash,
      strategy_snapshot_json: input.strategySnapshotJson,
      instrument: input.instrument,
      execution_timeframe: input.executionTimeframe,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      starting_balance: Number(input.startingBalance),
      risk_configuration: input.riskConfiguration ?? {},
      execution_model: input.executionModel ?? {},
      engine_version: input.engineVersion ?? '1.0.0',
      data_provider: input.dataProvider ?? 'Twelve Data',
      data_revision_fingerprint: input.dataRevisionFingerprint ?? '',
      status: 'QUEUED',
      failure_reason: null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();

  if (runError || !run) {
    throw new Error(`Backtest run creation failed. ${runError?.message ?? ''}`.trim());
  }

  const { data: usageRow, error: usageError } = await admin
    .from('backtest_usage')
    .select('*')
    .eq('user_id', input.userId)
    .eq('plan_code', planCode)
    .eq('billing_period_start', getBacktestPeriod(new Date()).startKey)
    .maybeSingle();

  if (usageError) {
    throw new Error(`Backtest usage ledger could not be updated. ${usageError.message}`);
  }

  if (usageRow) {
    await admin
      .from('backtest_usage')
      .update({
        run_count: Number(usageRow.run_count ?? 0) + 1,
        last_run_id: run.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', usageRow.id);
  }

  return run as BacktestRun;
}

export async function markBacktestRunning(runId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('backtest_runs')
    .update({
      status: 'RUNNING',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Backtest run ${runId} could not be marked running.`);
  }

  return data as BacktestRun;
}

export async function markBacktestCompleted(runId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('backtest_runs')
    .update({
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Backtest run ${runId} could not be marked completed.`);
  }

  return data as BacktestRun;
}

export async function markBacktestFailed(runId: string, failureReason: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('backtest_runs')
    .update({
      status: 'FAILED',
      failure_reason: failureReason,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Backtest run ${runId} could not be marked failed.`);
  }

  return data as BacktestRun;
}

export async function listBacktestRunsForUser(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('backtest_runs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Backtest runs could not be loaded. ${error.message}`);
  }

  return (data ?? []) as BacktestRun[];
}

export async function getBacktestRunForUser(userId: string, runId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('backtest_runs')
    .select('*')
    .eq('user_id', userId)
    .eq('id', runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Backtest run ${runId} could not be loaded. ${error.message}`);
  }

  return data as BacktestRun | null;
}

export async function getBacktestPlanCodeForUser(userId: string) {
  const founderOverride = serverEntitlementOverride(userId);
  if (founderOverride) {
    return founderOverride;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('billing_subscriptions')
    .select('plan,status')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Billing subscription could not be loaded. ${error.message}`);
  }

  const status = String(data?.status ?? 'inactive').toLowerCase();
  const plan = String(data?.plan ?? 'FREE').toUpperCase();
  const paid = ['active', 'trialing'].includes(status);
  if (!paid) {
    return 'FREE';
  }
  return ['PRO', 'ELITE', 'TEAM', 'FOUNDER'].includes(plan) ? plan : 'FREE';
}
