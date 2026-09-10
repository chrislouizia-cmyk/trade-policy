import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync('components/AnalyticsDashboard.tsx', 'utf8');

test('analytics keeps canonical closed-trade metric engine', () => {
  assert.match(source, /summarizeClosedTradeMetrics/);
  assert.match(source, /status:\s*'CLOSED'/);
});

test('analytics presents result, trajectory, then diagnosis', () => {
  const hero = source.indexOf('analytics-canonical-hero');
  const metrics = source.indexOf('analytics-canonical-metrics');
  const trajectory = source.indexOf('analytics-canonical-trajectory');
  const diagnosis = source.indexOf('analytics-canonical-diagnosis');
  const detail = source.indexOf('analytics-detail-disclosure');
  const recent = source.indexOf('analytics-canonical-recent');

  assert.ok(hero >= 0);
  assert.ok(metrics > hero);
  assert.ok(trajectory > metrics);
  assert.ok(diagnosis > trajectory);
  assert.ok(detail > diagnosis);
  assert.ok(recent > detail);
});

test('secondary edge analysis is progressive disclosure', () => {
  assert.match(source, /<details className="card analytics-detail-disclosure">/);
  assert.match(source, /analytics-canonical-secondary/);
  assert.match(source, /analytics-edge-grid/);
});

test('recent outcomes stay concise and hand off to canonical history', () => {
  assert.match(source, /ordered\.slice\(-5\)\.reverse\(\)/);
  assert.match(source, /href="\/history\?view=trades"/);
});
