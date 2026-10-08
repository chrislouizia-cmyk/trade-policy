import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const executor = fs.readFileSync('lib/server/backtest-executor.ts', 'utf8');
const route = fs.readFileSync('app/api/backtests/[id]/execute/route.ts', 'utf8');
const detail = fs.readFileSync('components/StrategyDetailPage.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/090_checkpoint_backtest_execution.sql', 'utf8');

test('simulation is bounded and returns a resumable deterministic checkpoint', () => {
  assert.match(executor, /deadlineMs\?: number/);
  assert.match(executor, /Date\.now\(\) >= options\.deadlineMs/);
  assert.match(executor, /nextExecutionIndex: i/);
  assert.match(executor, /dailyCounts: Object\.fromEntries\(dailyCounts\)/);
  assert.match(executor, /restored\?\.nextExecutionIndex/);
});

test('execute route persists progress and returns before the Vercel timeout', () => {
  assert.match(route, /SIMULATION_SLICE_MS = 20_000/);
  assert.match(route, /backtest_checkpoint_run_atomic/);
  assert.match(route, /SIMULATION_CHECKPOINTED/);
  assert.match(route, /continuationRequired: true/);
  assert.match(route, /deadlineMs: Date\.now\(\) \+ SIMULATION_SLICE_MS/);
});

test('checkpoint transition preserves the credit reservation and remains service-role only', () => {
  assert.match(migration, /status = 'QUEUED'/);
  assert.match(migration, /reservation\.status = 'RESERVED'/);
  assert.doesNotMatch(migration, /reserved_count\s*=\s*reserved_count\s*-/);
  assert.doesNotMatch(migration, /status\s*=\s*'CONSUMED'/);
  assert.match(migration, /revoke all on function public\.backtest_checkpoint_run_atomic[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.backtest_checkpoint_run_atomic[\s\S]*to service_role/i);
});

test('client continues checkpointed work automatically', () => {
  assert.match(detail, /payload\?\.continuationRequired/);
  assert.match(detail, /Historical replay is/);
  assert.match(detail, /executeQueuedRun\(runId\)/);
});
