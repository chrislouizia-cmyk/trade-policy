import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const detail = fs.readFileSync('components/StrategyDetailPage.tsx', 'utf8');

test('backtest polling swallows transient fetch failures instead of crashing the page', () => {
  assert.match(detail, /async function refreshBacktests\(\)/);
  assert.match(detail, /try \{/);
  assert.match(detail, /catch \(error\)/);
  assert.match(detail, /Backtest refresh temporarily unavailable/);
});

test('non-success backtest refreshes do not throw into the React runtime', () => {
  assert.match(detail, /if \(!response\.ok\)/);
  assert.match(detail, /return;/);
});

test('polling only runs while queued or running backtests exist', () => {
  assert.match(detail, /run\.status === 'QUEUED' \|\| run\.status === 'RUNNING'/);
  assert.match(detail, /if \(!hasActiveRun\) return/);
});
