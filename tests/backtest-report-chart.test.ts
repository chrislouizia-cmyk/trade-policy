import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEquityDrawdownSeries, renderEquityDrawdownSvg } from '../lib/backtesting/backtest-report-chart.ts';

test('equity series derives peak, drawdown, and cumulative R from persisted trades', () => {
  const points = buildEquityDrawdownSeries(10_000, '2026-06-20T00:00:00.000Z', [
    { sequence: 1, exit_timestamp: '2026-06-21T12:00:00.000Z', balance_after: 10_200, net_r: 2 },
    { sequence: 2, exit_timestamp: '2026-06-22T12:00:00.000Z', balance_after: 9_945, net_r: -2.5 },
  ]);

  assert.equal(points.length, 3);
  assert.equal(points[1].peakBalance, 10_200);
  assert.equal(points[2].peakBalance, 10_200);
  assert.equal(points[2].drawdownPercent, 2.5);
  assert.equal(points[2].cumulativeR, -0.5);
});

test('equity report graphic includes named axes, values, dates, legend, and accessible point detail', () => {
  const points = buildEquityDrawdownSeries(10_000, '2026-06-20T00:00:00.000Z', [
    { sequence: 1, exit_timestamp: '2026-07-01T12:00:00.000Z', balance_after: 10_100, net_r: 1 },
    { sequence: 2, exit_timestamp: '2026-07-10T12:00:00.000Z', balance_after: 9_999, net_r: -1 },
  ]);
  const svg = renderEquityDrawdownSvg(points);

  assert.match(svg, /ACCOUNT BALANCE/);
  assert.match(svg, /DRAWDOWN FROM PRIOR PEAK/);
  assert.match(svg, /TEST PERIOD \(UTC\)/);
  assert.match(svg, /Jun 20, 2026/);
  assert.match(svg, /10,000\.00/);
  assert.match(svg, /max drawdown 1\.00%/);
  assert.match(svg, /Trade 2: 9,999\.00 · 1\.00% drawdown/);
});
