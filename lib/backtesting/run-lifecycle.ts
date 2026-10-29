export const BACKTEST_EXECUTION_TIMEOUT_SECONDS = 300;
export const BACKTEST_STALE_LEASE_SECONDS = BACKTEST_EXECUTION_TIMEOUT_SECONDS + 60;

export type BacktestLeaseRun = {
  status?: string | null;
  started_at?: string | null;
};

export function backtestLeaseExpiresAt(run: BacktestLeaseRun): number | null {
  if (run.status !== 'RUNNING' || !run.started_at) return null;
  const startedAt = Date.parse(run.started_at);
  if (!Number.isFinite(startedAt)) return null;
  return startedAt + BACKTEST_STALE_LEASE_SECONDS * 1000;
}

export function isBacktestLeaseStale(run: BacktestLeaseRun, nowMs = Date.now()): boolean {
  const expiresAt = backtestLeaseExpiresAt(run);
  return expiresAt !== null && expiresAt <= nowMs;
}
