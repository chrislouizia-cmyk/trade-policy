import { NextResponse } from 'next/server';

import { BACKTEST_STALE_LEASE_SECONDS } from '@/lib/backtesting/run-lifecycle';
import { simulateBacktestFromSeries, strategyFromSnapshot, type BacktestSimulationCheckpoint } from '@/lib/server/backtest-executor';
import { prepareHistoricalBacktestData } from '@/lib/server/backtest-historical-cache';
import { getBacktestRunForUser } from '@/lib/server/backtesting';
import { apiError } from '@/lib/server/public-error';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { BacktestRun } from '@/types/backtesting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const SIMULATION_SLICE_MS = 20_000;

function logBacktestStage(runId: string, userId: string, stage: string, startedAt: number, detail: Record<string, unknown> = {}) {
  console.info('[BACKTEST_EXECUTION_STAGE]', {
    runId,
    userId,
    stage,
    elapsedMs: Date.now() - startedAt,
    deploymentCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ...detail,
  });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

  const { id } = await context.params;
  const requestStartedAt = Date.now();
  let run = await getBacktestRunForUser(user.id, id);
  if (!run) return apiError('BACKTEST_NOT_FOUND', 'Backtest run not found.', 404);

  if (run.status === 'COMPLETED') {
    return NextResponse.json({ runId: run.id, status: 'COMPLETED', alreadyCompleted: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (run.status === 'FAILED' || run.status === 'CANCELLED') {
    return apiError('BACKTEST_NOT_EXECUTABLE', `Backtest is ${run.status}.`, 409);
  }
  const admin = createAdminClient();

  if (run.status === 'RUNNING') {
    const { data: recovery, error: recoveryError } = await admin.rpc('backtest_reclaim_stale_run_atomic', {
      p_user_id: user.id,
      p_run_id: id,
      p_stale_after_seconds: BACKTEST_STALE_LEASE_SECONDS,
    });
    if (recoveryError) {
      console.error('[BACKTEST_STALE_RECOVERY_FAILED]', {
        runId: id,
        userId: user.id,
        errorCode: recoveryError.code ?? null,
        errorMessage: recoveryError.message,
      });
      return apiError('BACKTEST_RECOVERY_FAILED', 'Backtest recovery could not be completed. Please try again.', 500);
    }

    if (!(recovery as any)?.reclaimed) {
      return NextResponse.json({
        runId: run.id,
        status: 'RUNNING',
        alreadyRunning: true,
        retryAfterSeconds: Number((recovery as any)?.retry_after_seconds ?? 15),
      }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    }

    logBacktestStage(id, user.id, 'STALE_RUN_RECLAIMED', requestStartedAt, {
      recoveryCount: Number((recovery as any)?.recovery_count ?? 1),
    });
    run = await getBacktestRunForUser(user.id, id);
    if (!run || run.status !== 'QUEUED') {
      return apiError('BACKTEST_RECOVERY_INCONSISTENT', 'Backtest recovery did not produce a retryable run.', 409);
    }
  }

  let preparation;
  logBacktestStage(id, user.id, 'PREPARATION_STARTED', requestStartedAt);
  try {
    preparation = await prepareHistoricalBacktestData(run as BacktestRun, admin);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Historical market data preparation failed.';
    console.error('Backtest historical preparation failed', {
      runId: id,
      userId: user.id,
      internalReason: reason,
    });

    const providerUnavailable =
      /twelve data|api credit|credits|rate limit|too many requests|provider|market data|historical|cache/i.test(reason);

    return NextResponse.json({
      runId: id,
      status: 'QUEUED',
      preparingHistoricalData: true,
      retryAfterSeconds: 65,
      code: providerUnavailable ? 'HISTORICAL_MARKET_DATA_UNAVAILABLE' : 'HISTORICAL_PREPARATION_RETRY',
      message: providerUnavailable
        ? 'Historical market data is temporarily unavailable. Trade Police will retry shortly.'
        : 'Historical data preparation was interrupted. Trade Police will retry shortly.',
    }, {
      status: 202,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': '65',
      },
    });
  }

  if (!preparation.ready) {
    logBacktestStage(id, user.id, 'PREPARATION_DEFERRED', requestStartedAt, {
      requestsUsed: preparation.requestsUsed,
      retryAfterSeconds: preparation.retryAfterSeconds,
    });
    return NextResponse.json({
      runId: id,
      status: 'QUEUED',
      preparingHistoricalData: true,
      requestsUsed: preparation.requestsUsed,
      retryAfterSeconds: preparation.retryAfterSeconds,
      message: preparation.message,
    }, { status: 202, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(preparation.retryAfterSeconds) } });
  }

  const { data: claim, error: claimError } = await admin.rpc('backtest_claim_run_atomic', {
    p_user_id: user.id,
    p_run_id: id,
  });
  if (claimError) return apiError('BACKTEST_CLAIM_FAILED', claimError.message, 500);
  if (!(claim as any)?.claimed) {
    run = await getBacktestRunForUser(user.id, id);
    return NextResponse.json({ runId: id, status: run?.status ?? 'QUEUED', claimed: false }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  }

  run = { ...(run as BacktestRun), status: 'RUNNING' };
  logBacktestStage(id, user.id, 'RUN_CLAIMED', requestStartedAt);

  try {
    const strategy = strategyFromSnapshot(run as BacktestRun);
    const simulationStartedAt = Date.now();
    const checkpoint = (run.metadata?.execution_checkpoint ?? null) as BacktestSimulationCheckpoint | null;
    const output = simulateBacktestFromSeries(run as BacktestRun, strategy, preparation.historical, {
      checkpoint,
      deadlineMs: Date.now() + SIMULATION_SLICE_MS,
    });
    if (!output.complete) {
      const { data: continuation, error: continuationError } = await admin.rpc('backtest_checkpoint_run_atomic', {
        p_user_id: user.id,
        p_run_id: id,
        p_checkpoint: output.checkpoint,
        p_progress_percent: output.progressPercent,
      });
      if (continuationError) throw new Error(`Backtest checkpoint could not be persisted. ${continuationError.message}`);

      logBacktestStage(id, user.id, 'SIMULATION_CHECKPOINTED', requestStartedAt, {
        progressPercent: output.progressPercent,
        evaluatedCandles: output.evaluatedCandles,
        tradesProduced: output.tradesProduced,
      });

      return NextResponse.json({
        runId: id,
        status: 'QUEUED',
        continuationRequired: true,
        retryAfterSeconds: 1,
        progressPercent: output.progressPercent,
        evaluatedCandles: output.evaluatedCandles,
        tradesProduced: output.tradesProduced,
        lifecycle: continuation,
        message: `Historical replay is ${output.progressPercent.toFixed(0)}% complete. Continuing automatically…`,
      }, { status: 202, headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' } });
    }
    logBacktestStage(id, user.id, 'SIMULATION_COMPLETED', requestStartedAt, {
      simulationMs: Date.now() - simulationStartedAt,
      tradesProduced: output.trades.length,
    });
    const { data: completion, error: completionError } = await admin.rpc('backtest_complete_run_atomic', {
      p_user_id: user.id,
      p_run_id: id,
      p_result: output.result,
      p_trades: output.trades,
      p_metadata: { ...output.metadata, execution_checkpoint: null, execution_progress_percent: 100 },
    });
    if (completionError) throw new Error(completionError.message);

    logBacktestStage(id, user.id, 'RUN_COMPLETED', requestStartedAt, {
      tradesWritten: output.trades.length,
    });

    return NextResponse.json({
      runId: id,
      status: 'COMPLETED',
      result: output.result,
      tradesWritten: output.trades.length,
      lifecycle: completion,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Backtest execution failed.';

    console.error('Backtest execution failed', {
      runId: id,
      userId: user.id,
      internalReason: reason,
    });

    const { error: failError } = await admin.rpc('backtest_fail_run_atomic', {
      p_user_id: user.id,
      p_run_id: id,
      p_failure_reason: reason,
    });

    if (failError) {
      console.error('Backtest failure release failed', {
        runId: id,
        userId: user.id,
        error: failError,
      });
    }

    const providerUnavailable =
      /twelve data|api credit|credits|rate limit|too many requests|provider|market data/i.test(reason);

    return apiError(
      providerUnavailable ? 'HISTORICAL_MARKET_DATA_UNAVAILABLE' : 'BACKTEST_EXECUTION_FAILED',
      providerUnavailable
        ? 'Historical market data is temporarily unavailable. Please try again shortly.'
        : 'The backtest could not be completed. Please try again.',
      providerUnavailable ? 503 : 422,
      { creditReleased: !failError },
    );
  }
}
