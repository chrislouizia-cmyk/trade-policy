import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const cache = fs.readFileSync('lib/server/backtest-historical-cache.ts', 'utf8');
const executor = fs.readFileSync('lib/server/backtest-executor.ts', 'utf8');
const detail = fs.readFileSync('components/StrategyDetailPage.tsx', 'utf8');

test('historical preparation tolerates a small missing tail instead of retrying forever', () => {
  assert.match(cache, /MAX_ACCEPTABLE_TAIL_GAP_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(cache, /covered_end\) < wantedEnd - MAX_ACCEPTABLE_TAIL_GAP_MS/);
});

test('executor derives a common effective historical end from loaded candles', () => {
  assert.match(executor, /const commonHistoricalEnd =/);
  assert.match(executor, /const effectivePeriodEnd = Math\.min\(requestedPeriodEnd, commonHistoricalEnd\)/);
  assert.match(executor, /signalAtMs >= effectivePeriodEnd/);
});

test('report metadata preserves requested and effective historical period', () => {
  assert.match(executor, /requested_period_end: run\.period_end/);
  assert.match(executor, /effective_period_end:/);
  assert.match(executor, /data_freshness_seconds:/);
});

test('client explains truncated newest historical tail instead of hiding it', () => {
  assert.match(detail, /Historical data coverage/);
  assert.match(detail, /Backtest used complete historical data through/);
  assert.match(detail, /were excluded rather than blocking the run/);
});
