import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { resolveFinalRiskBaseVerdict } from '../lib/final-risk-verdict.ts';
import { applyTradingDnaRuntime, type TradingDnaEvidenceReport } from '../lib/trading-dna/runtime.ts';
import type { TradeResult } from '../types/trade.ts';

const baseInput = {
  hasVetoes: false,
  confidenceBelow: false,
  tradingDnaOwnsRuleGating: true,
  score: 25,
  authorizationScore: 80,
  waitScore: 60,
};

const baseResult: TradeResult = {
  score: 25,
  grade: 'C',
  verdict: 'AUTHORIZED',
  rr: 3,
  riskAmount: 10,
  stopDistance: 1,
  vetoes: [],
  observations: [],
  scoreItems: [],
};

function report(status: 'PASS' | 'FAIL' | 'PENDING'): TradingDnaEvidenceReport {
  return {
    status,
    summary: '',
    generatedAt: '2026-09-29T00:00:00.000Z',
    counts: { passed: status === 'PASS' ? 1 : 0, failed: status === 'FAIL' ? 1 : 0, pending: status === 'PENDING' ? 1 : 0 },
    groups: [],
    conditions: [{
      id: 'required',
      ruleId: 'smart-money.displacement',
      label: 'Displacement',
      status,
      required: true,
      weight: 10,
      evaluationType: 'AUTOMATIC',
      operator: 'CONFIRMED',
      actual: status === 'PASS' ? true : status === 'FAIL' ? false : null,
      expected: [],
      reason: 'Canonical runtime fixture.',
      groupPath: ['root'],
    }],
  };
}

test('optional-weight score cannot deny READY when Trading DNA owns required-rule gating', () => {
  assert.equal(resolveFinalRiskBaseVerdict(baseInput), 'AUTHORIZED');
  assert.equal(applyTradingDnaRuntime(baseResult, report('PASS')).verdict, 'AUTHORIZED');
});

test('canonical required failures and pending evidence still downgrade the final verdict', () => {
  assert.equal(applyTradingDnaRuntime(baseResult, report('FAIL')).verdict, 'REJECTED');
  assert.equal(applyTradingDnaRuntime(baseResult, report('PENDING')).verdict, 'WAIT');
});

test('risk vetoes and confidence gates retain precedence over Trading DNA', () => {
  assert.equal(resolveFinalRiskBaseVerdict({ ...baseInput, hasVetoes: true }), 'REJECTED');
  assert.equal(resolveFinalRiskBaseVerdict({ ...baseInput, confidenceBelow: true }), 'WAIT');
});

test('legacy strategies without Trading DNA retain score thresholds', () => {
  assert.equal(resolveFinalRiskBaseVerdict({ ...baseInput, tradingDnaOwnsRuleGating: false, score: 81 }), 'AUTHORIZED');
  assert.equal(resolveFinalRiskBaseVerdict({ ...baseInput, tradingDnaOwnsRuleGating: false, score: 70 }), 'WAIT');
  assert.equal(resolveFinalRiskBaseVerdict({ ...baseInput, tradingDnaOwnsRuleGating: false, score: 20 }), 'REJECTED');
});

test('active-trade reanalysis reapplies the frozen Trading DNA authority', () => {
  const source = fs.readFileSync('app/api/trades/reanalyze/route.ts', 'utf8');
  assert.match(source, /applyTradingDnaRuntime\(baseValidation,analysis\.tradingDnaReport\)/);
});
