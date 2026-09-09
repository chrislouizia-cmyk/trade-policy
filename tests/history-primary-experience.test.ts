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


test('H2 prioritizes trade identity, outcome, R and lifecycle context without removing evidence', () => {
  assert.match(page, /history-trade-identity/);
  assert.match(page, /history-trade-market[\s\S]*item\.instrument[\s\S]*item\.direction/);
  assert.match(page, /history-trade-result[\s\S]*outcomeLabel[\s\S]*formatR\(resultValue/);
  assert.match(page, /const lifecycleTime = item\.status === 'CLOSED' && item\.closedAt \? item\.closedAt : item\.openedAt/);
  assert.match(page, /history-trade-context[\s\S]*item\.strategyName[\s\S]*formatDateTime\(lifecycleTime, locale\)/);

  assert.match(page, /c\.entry[\s\S]*formatPrice\(item\.entry\)/);
  assert.match(page, /c\.stop[\s\S]*formatPrice\(item\.stopLoss\)/);
  assert.match(page, /c\.target[\s\S]*formatPrice\(item\.takeProfit\)/);
  assert.match(page, /c\.originalVerdict[\s\S]*item\.originalVerdict/);
  assert.match(page, /c\.initialRR[\s\S]*item\.initialRR/);
  assert.match(page, /c\.risk[\s\S]*item\.riskPercent/);
  assert.match(page, /item\.sourceReportId[\s\S]*c\.openDecision/);
  assert.match(page, /item\.status === 'OPEN'[\s\S]*href="\/active-trade"[\s\S]*c\.manageTrade/);
});

test('H2 keeps override visibility and removes the redundant separate outcome column', () => {
  assert.match(page, /item\.takenAgainstVerdict[\s\S]*c\.override/);
  assert.doesNotMatch(page, /<aside className="history-event-outcome">/);
});


test('H3 reads canonical active-trade events into the historical lifecycle', () => {
  assert.match(page, /from\('active_trade_events'\)/);
  assert.match(page, /select\('id,trade_id,event_type,verdict,current_price,current_r,created_at'\)/);
  assert.match(page, /buildHistoryJournal\([\s\S]*eventResult\.data/);
  assert.match(page, /eventResult\.error/);
});

test('H3 renders decision, entry, real reanalysis events, close and result without inventing management', () => {
  assert.match(page, /history-lifecycle-flow/);
  assert.match(page, /item\.linkedDecision[\s\S]*item\.linkedDecision\.occurredAt/);
  assert.match(page, /c\.entry[\s\S]*formatPrice\(item\.entry\)[\s\S]*item\.openedAt/);
  assert.match(page, /item\.events\.filter\(\(event\) => event\.eventType === 'REANALYSIS'\)/);
  assert.match(page, /event\.currentR/);
  assert.match(page, /event\.currentPrice/);
  assert.match(page, /item\.events\.find\(\(event\) => event\.eventType === 'CLOSED'\)/);
  assert.match(page, /item\.status === 'OPEN' \? c\.currentR : c\.result/);
});
