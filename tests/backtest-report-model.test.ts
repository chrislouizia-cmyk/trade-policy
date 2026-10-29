import assert from 'node:assert/strict';
import test from 'node:test';

import { BACKTEST_REPORT_MODEL_VERSION, buildBacktestReportModel } from '../lib/backtesting/backtest-report-model.ts';

const run = {
  id: '11111111-1111-4111-8111-111111111111', strategy_profile_id: '22222222-2222-4222-8222-222222222222',
  strategy_revision_id: '2:hash', strategy_snapshot_hash: 'snapshot-hash', strategy_snapshot_json: { name: 'Gold control', rules: [{ label: 'Sweep', mandatory: true }] },
  instrument: 'XAUUSD', execution_timeframe: 'M15', period_start: '2026-06-01T00:00:00Z', period_end: '2026-09-01T00:00:00Z',
  starting_balance: 10_000, engine_version: '1.0.0', data_provider: 'Twelve Data', data_revision_fingerprint: 'data-hash',
  execution_model: { policy: 'STOP_FIRST' }, risk_configuration: { riskPercent: 0.5 }, completed_at: '2026-09-01T01:00:00Z',
  metadata: { opportunity_funnel: { completed_trades: 1 }, rule_diagnostics: [{ rule_id: 'sweep' }], historical_data_coverage: [{ timeframe: 'M15' }], rule_logic: { source: 'V2_RULE_TREE' } },
};

test('canonical report model reconciles identity, UTC methodology, diagnostics and official trades', () => {
  const model = buildBacktestReportModel({
    run, result: { total_trades: 1, ending_balance: 10_100 }, trades: [{ sequence: 1, net_pnl: 100 }],
    user: { id: 'user', email: 'owner@example.com', user_metadata: { display_name: 'Strategy Owner' } },
    generatedAt: new Date('2026-09-02T12:00:00Z'),
  });
  assert.equal(model.version, BACKTEST_REPORT_MODEL_VERSION);
  assert.equal(model.identity.clientName, 'Strategy Owner');
  assert.equal(model.identity.reportId, `TP-BT-${run.id}`);
  assert.equal(model.methodology.timezone, 'UTC');
  assert.equal(model.methodology.periodStartUtc, '2026-06-01T00:00:00.000Z');
  assert.equal(model.performance.totalTrades, 1);
  assert.equal(model.performance.outcome.code, 'COMPLETED_WITH_TRADES');
  assert.equal(model.diagnostics.ruleDiagnostics.length, 1);
  assert.equal(model.diagnostics.candidateLedgerAvailable, false);
});

test('candidate hypotheticals remain explicitly separated from official performance', () => {
  const model = buildBacktestReportModel({
    run, result: { total_trades: 0 }, trades: [], user: { id: 'user', email: 'owner@example.com' },
    candidates: [{
      candidateKey: 'candidate-1', signalTimestampUtc: '2026-07-01T10:00:00Z', direction: 'LONG', disposition: 'OVERRIDE_ELIGIBLE',
      terminalStage: 'RISK', terminalReason: 'Minimum RR not met', blockingRuleId: 'minimum-rr', ruleEvaluations: [],
      officialTradeSequence: null, officialPerformance: false, hypothetical: { netR: 2 },
    }],
  });
  assert.equal(model.performance.totalTrades, 0);
  assert.equal(model.diagnostics.candidates[0]?.officialPerformance, false);
  assert.equal(model.audit.hypotheticalSeparatedFromOfficialPerformance, true);
});

test('legacy rule counters are normalized into coherent candidate gates and stable report provenance', () => {
  const model = buildBacktestReportModel({
    run: {
      ...run,
      data_revision_fingerprint: '',
      metadata: {
        ...run.metadata,
        historical_data_fingerprint: 'derived-data-hash',
        rule_diagnostics: [{ candidates_before: 10, candidates_after: 4, rejected: 999, insufficient_data: 3 }],
      },
    },
    result: { total_trades: 0 }, trades: [], user: { id: 'user' },
    candidates: [{
      candidate_key: 'candidate-legacy', signal_timestamp_utc: '2026-07-01T10:00:00Z', direction: 'SHORT', disposition: 'REJECTED',
      terminal_stage: 'DIRECTION', terminal_reason: 'Direction not allowed', blocking_rule_id: 'direction', rule_evaluations: [],
      official_trade_sequence: null, official_performance: false, hypothetical: null,
    }],
  });
  assert.equal(model.generatedAtUtc, '2026-09-01T01:00:00.000Z');
  assert.equal(model.methodology.dataFingerprint, 'derived-data-hash');
  assert.equal(model.diagnostics.ruleDiagnostics[0]?.candidate_rule_failed, 6);
  assert.equal(model.diagnostics.ruleDiagnostics[0]?.observed_not_matched, 999);
  assert.equal(model.diagnostics.candidates[0]?.candidateKey, 'candidate-legacy');
  assert.equal(model.diagnostics.candidateLedgerAvailable, true);
});

test('invalid report timestamps fail closed instead of producing inconsistent PDF and XLSX dates', () => {
  assert.throws(() => buildBacktestReportModel({ run: { ...run, period_start: 'invalid' }, result: {}, trades: [], user: { id: 'user' } }), /invalid UTC timestamp/);
});
