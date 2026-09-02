import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildHistoryJournal,
  filterHistoryJournal,
  summarizeHistoryJournal,
  type HistoryDecisionRow,
  type HistoryTradeRow,
} from '../lib/history-journal.ts';

const decision = (overrides: Partial<HistoryDecisionRow> = {}): HistoryDecisionRow => ({
  id: 'report-1',
  created_at: '2026-09-01T22:40:00.000Z',
  instrument: 'XAUUSD',
  timeframe: 'M5',
  strategy_id: 'strategy-1',
  strategy_name: 'Gold Liquidity Sweep v1',
  verdict: 'REJECTED',
  primary_reason: 'Liquidity sweep is mandatory.',
  data_freshness: 'LIVE',
  market_provider: 'Twelve Data',
  readiness_percent: 60,
  snapshot_json: {},
  ...overrides,
});

const trade = (overrides: Partial<HistoryTradeRow> = {}): HistoryTradeRow => ({
  id: 'trade-1',
  trade_record_id: 'record-1',
  instrument: 'XAUUSD',
  direction: 'SELL',
  entry: 4327.81,
  stop_loss: 4340,
  take_profit: 4300,
  risk_percent: 0.5,
  initial_rr: 2.28,
  setup_type: 'Continuation',
  status: 'OPEN',
  current_r: 0.25,
  taken_against_verdict: true,
  original_verdict: 'REJECTED',
  original_verdict_reason: 'Liquidity sweep is mandatory.',
  override_reason: 'Manual confirmation',
  close_price: null,
  result_r: null,
  outcome: null,
  opened_at: '2026-09-01T22:42:00.000Z',
  closed_at: null,
  strategy_profile_id: 'strategy-1',
  strategy_name_at_entry: null,
  strategy_snapshot: { name: 'Gold Liquidity Sweep v1' },
  strategy_revision_id: 'revision-1',
  source_report_id: 'report-1',
  activation_mode: 'OVERRIDE',
  ...overrides,
});

test('journal links a converted decision to its trade without duplicating the lifecycle', () => {
  const journal = buildHistoryJournal(
    [trade()],
    [decision(), decision({ id: 'report-2', created_at: '2026-09-01T21:00:00.000Z', verdict: 'WAIT' })],
  );
  assert.equal(journal.trades.length, 1);
  assert.equal(journal.decisions.length, 2);
  assert.equal(journal.all.length, 2);
  assert.equal(journal.all[0].kind, 'TRADE');
  assert.equal(journal.trades[0].linkedDecision?.id, 'report-1');
  assert.equal(journal.all[1].id, 'report-2');
});

test('internal simulations stay out of every customer-facing journal view', () => {
  const journal = buildHistoryJournal(
    [trade({ id: 'trade-sim', source_report_id: null, strategy_snapshot: { simulationMode: 'INTERNAL_LIFECYCLE_SMOKE_TEST' } })],
    [decision({ id: 'report-sim', snapshot_json: { testSource: 'INTERNAL_LIFECYCLE_SMOKE_TEST' } })],
  );
  assert.deepEqual(journal, { trades: [], decisions: [], all: [] });
});

test('summary uses only persisted trade lifecycle values and never fabricates realized R', () => {
  const journal = buildHistoryJournal([
    trade(),
    trade({ id: 'trade-2', status: 'CLOSED', opened_at: '2026-08-31T12:00:00.000Z', closed_at: '2026-09-01T20:00:00.000Z', result_r: 1.5, outcome: 'WIN', source_report_id: null }),
    trade({ id: 'trade-3', status: 'CLOSED', opened_at: '2026-08-30T12:00:00.000Z', closed_at: '2026-09-01T19:00:00.000Z', result_r: -1, outcome: 'LOSS', source_report_id: null }),
  ], [decision()]);
  assert.deepEqual(summarizeHistoryJournal(journal.trades, journal.decisions), {
    openTrades: 1,
    closedTrades: 2,
    savedDecisions: 1,
    realizedR: 0.5,
  });
  const noResult = buildHistoryJournal([trade({ status: 'CLOSED', closed_at: '2026-09-01T20:00:00.000Z', result_r: null })], []);
  assert.equal(summarizeHistoryJournal(noResult.trades, []).realizedR, null);
});

test('journal filters support record lifecycle, outcome, verdict, strategy, and dates', () => {
  const journal = buildHistoryJournal([
    trade(),
    trade({ id: 'trade-2', status: 'CLOSED', opened_at: '2026-08-31T12:00:00.000Z', closed_at: '2026-09-01T20:00:00.000Z', result_r: 1.5, outcome: 'WIN', source_report_id: null }),
  ], [decision(), decision({ id: 'report-2', instrument: 'GBPJPY', strategy_id: 'strategy-2', strategy_name: 'London Breakout', verdict: 'READY', created_at: '2026-08-15T10:00:00.000Z' })]);
  assert.deepEqual(filterHistoryJournal(journal.trades, { status: 'OPEN' }).map((item) => item.id), ['trade-1']);
  assert.deepEqual(filterHistoryJournal(journal.trades, { result: 'WIN' }).map((item) => item.id), ['trade-2']);
  assert.deepEqual(filterHistoryJournal(journal.decisions, { verdict: 'READY', strategy: 'strategy-2' }).map((item) => item.id), ['report-2']);
  assert.deepEqual(filterHistoryJournal(journal.all, { from: '2026-09-01', q: 'gold' }).map((item) => item.id), ['trade-1', 'trade-2']);
});

test('History page reads canonical trades and decisions and exposes truthful journal controls', () => {
  const page = fs.readFileSync('app/history/page.tsx', 'utf8');
  assert.match(page, /from\('active_trades'\)/);
  assert.match(page, /from\('decision_reports'\)/);
  assert.doesNotMatch(page, /from\('trade_records'\)/);
  assert.match(page, /All activity/);
  assert.match(page, /Open trades/);
  assert.match(page, /Realized R/);
  assert.match(page, /SIMULATION \/ INTERNAL TEST records are excluded/);
  assert.match(page, /Opened \{formatDateTime\(item\.openedAt\)\}/);
  assert.match(page, /Closed \{formatDateTime\(item\.closedAt\)\}/);
});
