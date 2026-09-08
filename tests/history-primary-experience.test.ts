import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/history/page.tsx', import.meta.url), 'utf8');
const report = readFileSync(new URL('../app/history/[reportId]/page.tsx', import.meta.url), 'utf8');

test('History opens canonical trade lifecycle records by default', () => {
  assert.match(page, /: 'trades';/);
  assert.match(page, /function tabHref[\s\S]*view === 'trades' \? '\/history'/);
  assert.match(page, /href="\/history" aria-current=\{selectedView === 'trades'/);
});

test('decisions and the combined journal remain explicitly reachable', () => {
  assert.match(page, /href="\/history\?view=decisions"/);
  assert.match(page, /href="\/history\?view=all"/);
  assert.match(page, /selectedView === 'decisions' \? journal\.decisions : journal\.all/);
  assert.match(report, /href="\/history\?view=decisions">← All saved reports/);
});

test('filter submissions preserve every non-default History view', () => {
  assert.match(page, /selectedView !== 'trades' \? <input type="hidden" name="view" value=\{selectedView\}/);
  assert.match(page, /const clearHref = tabHref\(selectedView\)/);
});

test('H1 preserves canonical sources and lifecycle deduplication', () => {
  assert.match(page, /from\('active_trades'\)/);
  assert.match(page, /from\('decision_reports'\)/);
  assert.match(page, /buildHistoryJournal/);
  assert.doesNotMatch(page, /from\('trade_records'\)/);
});
