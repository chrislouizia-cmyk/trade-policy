import assert from 'node:assert/strict';
import test from 'node:test';

import { backtestOutcome } from '../lib/backtesting/backtest-report.ts';

test('positive control is classified from persisted trades independently of funnel detail', () => {
  assert.equal(backtestOutcome(6, {}).code, 'COMPLETED_WITH_TRADES');
});

test('Sniper-shaped funnel identifies the historical-rule prefilter as the zero stage', () => {
  const outcome = backtestOutcome(0, { opportunity_funnel: {
    execution_candles_evaluated: 20_405,
    multi_timeframe_context_ready: 20_405,
    rejected_historical_rules: 20_405,
    analysis_completed: 0,
  } });
  assert.equal(outcome.code, 'ZERO_NO_RULE_CONVERGENCE');
  assert.match(outcome.explanation, /20,405/);
});

test('analysis failures and legacy runs are not mislabeled as valid zero-trade findings', () => {
  assert.equal(backtestOutcome(0, { opportunity_funnel: {
    execution_candles_evaluated: 100, multi_timeframe_context_ready: 100, analysis_errors: 100, analysis_completed: 0,
  } }).code, 'ZERO_ANALYSIS_ERRORS');
  assert.equal(backtestOutcome(0, {}).code, 'ZERO_INCONCLUSIVE');
});
