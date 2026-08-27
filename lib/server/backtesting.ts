import 'server-only';

import { serverEntitlementOverride } from '@/lib/billing/overrides';
import { createAdminClient } from '@/lib/supabase/admin';
import { strategyRevisionId } from '@/lib/historical-decisions/strategy-revision';
import { stableFingerprint } from '@/lib/market-intelligence/serialization/stable-fingerprint';
import type { BacktestRun, BacktestUsage } from '@/types/backtesting';
import type { StrategyProfile } from '@/types/trade';

export const BACKTEST_PLAN_LIMITS = {
  FREE: 1,
  PRIVATE_BETA: 10,
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
    allowed: limit === null || (Number(usage.used_count ?? usage.run_count ?? 0) + Number(usage.reserved_count ?? 0) < Number(limit)),
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
  idempotencyKey?: string | null;
}) {
  const admin = createAdminClient();
  const { data: creation, error: creationError } = await admin.rpc('backtest_create_run_atomic', {
    p_user_id: input.userId,
    p_workspace_id: input.workspaceId ?? null,
    p_strategy_profile_id: input.strategyProfileId,
    p_strategy_revision_id: input.strategyRevisionId,
    p_strategy_snapshot_hash: input.strategySnapshotHash,
    p_strategy_snapshot_json: input.strategySnapshotJson,
    p_instrument: input.instrument,
    p_execution_timeframe: input.executionTimeframe,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_starting_balance: Number(input.startingBalance),
    p_risk_configuration: input.riskConfiguration ?? {},
    p_execution_model: input.executionModel ?? {},
    p_engine_version: input.engineVersion ?? '1.0.0',
    p_data_provider: input.dataProvider ?? 'Twelve Data',
    p_data_revision_fingerprint: input.dataRevisionFingerprint ?? '',
    p_metadata: input.metadata ?? {},
    p_plan_code: String(input.planCode ?? 'FREE').toUpperCase(),
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  if (creationError) {
    throw new Error(`Backtest run creation failed. ${creationError.message}`.trim());
  }

  const runId = String((creation as any)?.run_id ?? '');
  if (!runId) {
    throw new Error('Backtest run creation failed. Atomic RPC returned no run id.');
  }

  const { data: run, error: runError } = await admin
    .from('backtest_runs')
    .select('*')
    .eq('id', runId)
    .eq('user_id', input.userId)
    .single();

  if (runError || !run) {
    throw new Error(`Backtest run ${runId} could not be loaded after atomic creation.`);
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
  const { data, error } = await admin.rpc('backtest_get_plan_code_for_user', {
    p_user_id: userId,
  });

  if (error || !data) {
    throw new Error(`Backtest entitlement could not be resolved. ${error?.message ?? ''}`.trim());
  }

  return String(data).trim().toUpperCase() as BacktestPlanCode;
}
