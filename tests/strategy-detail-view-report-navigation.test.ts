import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const detail = fs.readFileSync('components/StrategyDetailPage.tsx', 'utf8');

test('View Report opens the dedicated report modal', () => {
  assert.match(detail, /async function openRunReport\(run: BacktestRunRow\)/);
  assert.match(detail, /setSelectedRunId\(run\.id\)/);
  assert.match(detail, /setReportModalOpen\(true\)/);
});

test('View Report no longer scrolls the Strategy page', () => {
  assert.doesNotMatch(detail, /scrollIntoView/);
  assert.doesNotMatch(detail, /reportSectionRef/);
});

test('completed history action still invokes openRunReport', () => {
  assert.match(detail, /openRunReport\(run\)/);
});
