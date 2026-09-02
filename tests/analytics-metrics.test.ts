import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeClosedTradeMetrics,
  buildCumulativeRSeries,
  isAnalyticsSimulationRow,
} from '../lib/analytics/closed-trade-metrics.ts';
import fs from 'node:fs';

const baseTrades = [
  { id: 't1', status: 'CLOSED', closed_at: '2024-01-01T00:00:00.000Z', outcome: 'WIN', result_r: 1, source: 'EXECUTED', strategy_snapshot: null, simulation_mode: null },
  { id: 't2', status: 'CLOSED', closed_at: '2024-01-03T00:00:00.000Z', outcome: 'LOSS', result_r: -0.5, source: 'EXECUTED', strategy_snapshot: null, simulation_mode: null },
  { id: 't3', status: 'CLOSED', closed_at: '2024-01-05T00:00:00.000Z', outcome: 'BREAKEVEN', result_r: 0, source: 'EXECUTED', strategy_snapshot: null, simulation_mode: null },
];

test('closed-trade metrics count only canonical real trades and exclude simulation rows', () => {
  const rows = [
    ...baseTrades,
    {
      id: 't-sim',
      status: 'CLOSED',
      closed_at: '2024-01-08T00:00:00.000Z',
      outcome: 'WIN',
      result_r: 2,
      source: 'EXECUTED',
      strategy_snapshot: { simulationMode: 'INTERNAL_LIFECYCLE_SMOKE_TEST' },
      simulation_mode: 'INTERNAL_LIFECYCLE_SMOKE_TEST',
    },
  ];

  const metrics = summarizeClosedTradeMetrics(rows as any);

  assert.equal(metrics.sampleSize, 3);
  assert.equal(metrics.wins, 1);
  assert.equal(metrics.losses, 1);
  assert.equal(metrics.breakeven, 1);
  assert.equal(metrics.netR, 0.5);
  assert.equal(metrics.winRate, 33.33333333333333);
  assert.equal(metrics.averageR, 0.16666666666666666);
  assert.equal(metrics.averageWinner, 1);
  assert.equal(metrics.averageLoser, 0.5);
  assert.equal(metrics.profitFactor, 2);
  assert.equal(isAnalyticsSimulationRow(rows[3] as any), true);
});

test('zero-trade metrics return unavailable values instead of fabricated zeros', () => {
  const metrics = summarizeClosedTradeMetrics([] as any);

  assert.equal(metrics.sampleSize, 0);
  assert.equal(metrics.winRate, null);
  assert.equal(metrics.netR, null);
  assert.equal(metrics.averageR, null);
  assert.equal(metrics.averageWinner, null);
  assert.equal(metrics.averageLoser, null);
  assert.equal(metrics.profitFactor, null);
  assert.deepEqual(buildCumulativeRSeries([] as any), []);
});

test('cumulative R is chronological and deterministic', () => {
  const series = buildCumulativeRSeries(baseTrades as any);
  assert.deepEqual(series.map((point) => point.value), [1, 0.5, 0.5]);
  assert.deepEqual(series.map((point) => point.label), ['2024-01-01T00:00:00.000Z', '2024-01-03T00:00:00.000Z', '2024-01-05T00:00:00.000Z']);
});

test('profit factor is unavailable when gross losses are zero or no trades exist', () => {
  const metrics = summarizeClosedTradeMetrics([
    { id: 'only-win', status: 'CLOSED', closed_at: '2024-01-01T00:00:00.000Z', outcome: 'WIN', result_r: 1.25, source: 'EXECUTED', strategy_snapshot: null, simulation_mode: null },
  ] as any);

  assert.equal(metrics.profitFactor, null);
});

test('Analytics reads canonical active trades and adapts UI fields to metric fields', () => {
  const page = fs.readFileSync('app/analytics/page.tsx', 'utf8');
  const dashboard = fs.readFileSync('components/AnalyticsDashboard.tsx', 'utf8');

  assert.match(page, /from\('active_trades'\)/);
  assert.doesNotMatch(page, /from\('trade_records'\)/);
  assert.match(page, /eq\('status','CLOSED'\)/);
  assert.match(page, /ANALYTICS_CLOSED_TRADES_LOAD_FAILED/);
  assert.match(page, /export const dynamic = 'force-dynamic'/);
  assert.match(dashboard, /status: 'CLOSED'/);
  assert.match(dashboard, /closed_at: trade\.closedAt/);
  assert.match(dashboard, /result_r: trade\.resultR/);
  assert.match(dashboard, /active_trades\.status = CLOSED/);
  assert.match(dashboard, /PERFORMANCE COCKPIT/);
  assert.match(dashboard, /analytics-primary-metrics/);
  assert.match(dashboard, /viewBox="0 0 100 40"/);
  assert.match(dashboard, /Where performance comes from/);
});
