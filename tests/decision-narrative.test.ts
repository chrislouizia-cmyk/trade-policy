import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDecisionNarrative, recommendationForVerdict } from '../lib/intelligence/decision-narrative.ts';
import { DEFAULT_STRATEGY_PROFILE } from '../types/trade.ts';
import type { StrategyProfile, TradeInput, TradeResult } from '../types/trade.ts';

const strategy: StrategyProfile = {
  ...DEFAULT_STRATEGY_PROFILE,
  id: '11111111-1111-4111-8111-111111111111',
  macroTimeframe: 'D1',
  triggerTimeframe: 'M5',
  rules: [
    {
      ruleKey: 'liquiditySweep',
      label: 'Liquidity sweep',
      enabled: true,
      mandatory: true,
      weight: 10,
      minimumConfidence: 70,
      timeframeRole: 'CONFIRMATION',
      evaluationMode: 'AUTOMATIC',
    },
    {
      ruleKey: 'retestConfirmed',
      label: 'Entry retest',
      enabled: true,
      mandatory: true,
      weight: 10,
      minimumConfidence: 80,
      timeframeRole: 'ENTRY',
      evaluationMode: 'MANUAL',
    },
  ],
};

const input: TradeInput = {
  instrument: 'XAUUSD',
  direction: 'BUY',
  entry: 100,
  stopLoss: 99,
  takeProfit: 103,
  accountBalance: 10_000,
  riskPercent: 0.5,
  tradesToday: 0,
  session: 'LONDON',
  highImpactNews: false,
  h4TrendAligned: true,
  h1TrendAligned: true,
  structurePattern: true,
  liquiditySweep: false,
  chochConfirmed: true,
  bosConfirmed: true,
  orderBlock: true,
  fairValueGap: true,
  retestConfirmed: false,
  setupType: 'Trend Continuation',
  setupConfidence: 72,
  manualConfirmations: [],
};

function result(overrides: Partial<TradeResult> = {}): TradeResult {
  return {
    score: 76,
    grade: 'B',
    verdict: 'WAIT',
    rr: 3,
    riskAmount: 50,
    stopDistance: 1,
    vetoes: [],
    observations: ['Confidence 72% is below the required 80% threshold.'],
    scoreItems: [],
    ...overrides,
  };
}

test('maps deterministic verdicts to the exact Copilot recommendations', () => {
  assert.equal(recommendationForVerdict('AUTHORIZED'), 'ENTER');
  assert.equal(recommendationForVerdict('WAIT'), 'WAIT');
  assert.equal(recommendationForVerdict('REJECTED'), 'BLOCK');
});

test('keeps automatic and manual missing evidence separate', () => {
  const narrative = buildDecisionNarrative({ result: result(), strategy, input });
  const automatic = narrative.missingEvidence.find((item) => item.evidenceKey === 'liquiditySweep');
  const manual = narrative.missingEvidence.find((item) => item.evidenceKey === 'retestConfirmed');

  assert.equal(automatic?.evaluationMode, 'AUTOMATIC');
  assert.equal(automatic?.canUserConfirm, false);
  assert.equal(automatic?.detected, false);
  assert.equal(manual?.evaluationMode, 'MANUAL');
  assert.equal(manual?.canUserConfirm, true);
  assert.equal(manual?.detected, null);
  assert.equal(narrative.strategyContext.automaticRuleCount, 1);
  assert.equal(narrative.strategyContext.manualRuleCount, 1);
});

test('manual confirmation action appears only for configured manual rules', () => {
  const narrative = buildDecisionNarrative({ result: result(), strategy, input });
  const manualAction = narrative.nextActions.find(
    (action) => action.type === 'CONFIRM_MANUAL_EVIDENCE',
  );

  assert.deepEqual(manualAction?.relatedEvidenceIds, ['evidence:retestConfirmed']);
  assert.ok(!manualAction?.relatedEvidenceIds.includes('evidence:liquiditySweep'));
});

test('blocking reasons and actions rank before advisory material', () => {
  const narrative = buildDecisionNarrative({
    result: result({
      verdict: 'REJECTED',
      vetoes: ['Risk exceeds 0.5%.'],
      observations: ['Retest remains pending.'],
    }),
    strategy,
    input,
  });

  assert.equal(narrative.recommendation, 'BLOCK');
  assert.equal(narrative.reasons[0].blocking, true);
  assert.equal(narrative.reasons.at(-1)?.blocking, false);
  assert.equal(narrative.nextActions[0].type, 'DO_NOT_TRADE');
  assert.equal(narrative.nextActions[0].blocking, true);
});

test('labels readiness as evidence readiness and never profit probability', () => {
  const narrative = buildDecisionNarrative({ result: result(), strategy, input });

  assert.equal(narrative.readiness.label, 'Evidence readiness');
  assert.equal(narrative.readiness.isProbability, false);
  assert.equal(narrative.readiness.currentScore, 72);
  assert.equal(narrative.readiness.requiredScore, 80);
  assert.doesNotMatch(JSON.stringify(narrative), /probability of profit/i);
});

test('reports incomplete strategy context instead of inventing required values', () => {
  const incomplete = {
    ...strategy,
    id: undefined,
    triggerTimeframe: undefined,
    aiBehavior: undefined,
  };
  const narrative = buildDecisionNarrative({ result: result(), strategy: incomplete, input });

  assert.equal(narrative.strategyContext.complete, false);
  assert.equal(narrative.strategyContext.confidenceThreshold, null);
  assert.ok(narrative.strategyContext.missingFields.includes('strategy id'));
  assert.ok(narrative.strategyContext.missingFields.includes('five-layer timeframe model'));
  assert.ok(narrative.strategyContext.missingFields.includes('confidence threshold'));
});
