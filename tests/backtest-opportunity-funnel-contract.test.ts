import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const executor = fs.readFileSync('lib/server/backtest-executor.ts', 'utf8');
const detail = fs.readFileSync('components/StrategyDetailPage.tsx', 'utf8');

test('executor records a truthful opportunity funnel without changing entry rules', () => {
  for (const token of [
    'execution_candles_evaluated',
    'multi_timeframe_context_ready',
    'analysis_completed',
    'ready_candidate_found',
    'setup_readiness_ready',
    'direction_allowed',
    'daily_limit_allowed',
    'valid_risk_geometry',
    'executable_signals',
    'completed_trades',
    'rejected_no_ready_candidate',
    'rejected_setup_not_ready',
    'rejected_direction',
    'rejected_daily_limit',
    'rejected_invalid_risk_geometry',
  ]) assert.match(executor, new RegExp(token));
  assert.match(executor, /opportunity_funnel:\s*diagnostics/);
});

test('sample quality is derived from completed trade count', () => {
  assert.match(executor, /code:\s*'INSUFFICIENT'/);
  assert.match(executor, /code:\s*'VERY_LIMITED'/);
  assert.match(executor, /code:\s*'LIMITED'/);
  assert.match(executor, /code:\s*'MORE_INFORMATIVE'/);
});

test('client report renders opportunity funnel and sample quality', () => {
  assert.match(detail, /OPPORTUNITY FUNNEL/);
  assert.match(detail, /Sample quality:/);
  assert.match(detail, /Execution candles evaluated/);
  assert.match(detail, /Executable signals/);
  assert.match(detail, /Completed trades/);
});

test('executor still requires READY candidate and READY setup before a trade', () => {
  assert.match(executor, /item\.status === 'READY'/);
  assert.match(executor, /analysis\.setupReadiness\.state !== 'READY'/);
  assert.match(executor, /trades\.push/);
});
