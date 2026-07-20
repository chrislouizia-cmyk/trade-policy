import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDecisionNarrative } from '../lib/intelligence/decision-narrative.ts';
import { enhanceDecisionNarrative } from '../lib/server/decision-narrative-ai.ts';
import { DEFAULT_STRATEGY_PROFILE } from '../types/trade.ts';
import type { DecisionNarrative } from '../types/intelligence.ts';
import type { StrategyProfile, TradeInput, TradeResult } from '../types/trade.ts';

const generatedAt = '2026-07-20T12:00:00.000Z';

const strategy: StrategyProfile = {
  ...DEFAULT_STRATEGY_PROFILE,
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Contract Strategy',
  macroTimeframe: 'D1',
  trendTimeframe: 'H4',
  confirmationTimeframe: 'H1',
  entryTimeframe: 'M30',
  triggerTimeframe: 'M5',
  preferredSetups: ['Trend Continuation'],
  rejectUnlistedSetups: false,
  allowedSessions: ['LONDON', 'NEW_YORK'],
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

const completeInput: TradeInput = {
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
  liquiditySweep: true,
  chochConfirmed: true,
  bosConfirmed: true,
  orderBlock: true,
  fairValueGap: true,
  retestConfirmed: true,
  setupType: 'Trend Continuation',
  setupConfidence: 86,
  manualConfirmations: [{ evidenceKey: 'retestConfirmed', confirmed: true }],
};

function tradeResult(overrides: Partial<TradeResult>): TradeResult {
  return {
    score: 88,
    grade: 'A',
    verdict: 'AUTHORIZED',
    rr: 3,
    riskAmount: 50,
    stopDistance: 1,
    vetoes: [],
    observations: [],
    scoreItems: [],
    direction: 'BUY',
    overrideAllowed: true,
    ...overrides,
  };
}

function normalized(narrative: DecisionNarrative) {
  const { generatedAt: timestamp, ...contract } = narrative;
  assert.equal(timestamp, generatedAt);
  return contract;
}

const strategyContext = {
  complete: true,
  missingFields: [],
  strategyId: '11111111-1111-4111-8111-111111111111',
  strategyName: 'Contract Strategy',
  engineVersion: 2,
  confidenceThreshold: 80,
  fiveLayerModel: [
    { layer: 1, role: 'MACRO', timeframe: 'D1' },
    { layer: 2, role: 'TREND', timeframe: 'H4' },
    { layer: 3, role: 'CONFIRMATION', timeframe: 'H1' },
    { layer: 4, role: 'ENTRY', timeframe: 'M30' },
    { layer: 5, role: 'TRIGGER', timeframe: 'M5' },
  ],
  mandatoryRuleCount: 2,
  optionalRuleCount: 0,
  automaticRuleCount: 1,
  manualRuleCount: 1,
  permittedSessions: ['LONDON', 'NEW_YORK'],
  allowedSetups: null,
  riskPolicy: { maxRiskPercentage: 0.5, minimumRiskReward: 3 },
};

test('AUTHORIZED → ENTER freezes the complete deterministic narrative contract', () => {
  const narrative = buildDecisionNarrative({
    result: tradeResult({ verdict: 'AUTHORIZED' }),
    strategy,
    input: completeInput,
    now: new Date(generatedAt),
  });

  assert.deepEqual(normalized(narrative), {
    version: '1',
    recommendation: 'ENTER',
    engineVerdict: 'AUTHORIZED',
    source: 'DETERMINISTIC',
    headline: 'ENTER — strategy conditions passed',
    explanation: 'The final deterministic validation passed without a blocking reason.',
    reasons: [],
    missingEvidence: [],
    nextActions: [{
      id: 'action:review-entry',
      type: 'REVIEW_ENTRY',
      priority: 1,
      label: 'Review the entry before execution',
      rationale: 'The strategy conditions passed; verify price and order details before accepting risk.',
      blocking: false,
      relatedEvidenceIds: [],
    }],
    strategyContext,
    readiness: {
      currentScore: 86,
      requiredScore: 80,
      label: 'Evidence readiness',
      isProbability: false,
    },
    disciplineMessage: 'Authorization is not a profit guarantee. Confirm the order details and accept only the configured risk.',
    fallbackUsed: false,
  });
  assert.equal(narrative.educationalExplanation, undefined);
  assert.equal(narrative.coachingMessage, undefined);
  assert.equal(narrative.learningTip, undefined);
});

test('WAIT → WAIT freezes missing evidence, actions, and fallback contract', async () => {
  const input: TradeInput = {
    ...completeInput,
    liquiditySweep: false,
    retestConfirmed: false,
    setupConfidence: 72,
    manualConfirmations: [],
  };
  const deterministic = buildDecisionNarrative({
    result: tradeResult({
      verdict: 'WAIT',
      score: 76,
      grade: 'B',
      observations: ['Confidence 72% is below the required 80% threshold.'],
    }),
    strategy,
    input,
    now: new Date(generatedAt),
  });
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const narrative = await enhanceDecisionNarrative(deterministic);
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;

  assert.deepEqual(normalized(narrative), {
    version: '1',
    recommendation: 'WAIT',
    engineVerdict: 'WAIT',
    source: 'DETERMINISTIC',
    headline: 'WAIT — more confirmation is required',
    explanation: 'Evidence readiness is 72% against the required 80%.',
    reasons: [{
      id: 'observation:0:confidence-72-is-below-the-required-80-threshold',
      code: 'ENGINE_OBSERVATION',
      category: 'EVIDENCE',
      status: 'ADVISORY',
      origin: 'RISK_ENGINE',
      message: 'Confidence 72% is below the required 80% threshold.',
      blocking: false,
    }],
    missingEvidence: [
      {
        id: 'evidence:liquiditySweep',
        evidenceKey: 'liquiditySweep',
        ruleKey: 'liquiditySweep',
        label: 'Liquidity sweep',
        layer: 3,
        timeframe: 'H1',
        evaluationMode: 'AUTOMATIC',
        mandatory: true,
        detected: false,
        confidence: null,
        minimumConfidence: 70,
        reason: 'Liquidity sweep has not been detected automatically.',
        canUserConfirm: false,
      },
      {
        id: 'evidence:retestConfirmed',
        evidenceKey: 'retestConfirmed',
        ruleKey: 'retestConfirmed',
        label: 'Entry retest',
        layer: 4,
        timeframe: 'M30',
        evaluationMode: 'MANUAL',
        mandatory: true,
        detected: null,
        confidence: null,
        minimumConfidence: 80,
        reason: 'Entry retest requires trader confirmation.',
        canUserConfirm: true,
      },
    ],
    nextActions: [
      {
        id: 'action:wait-for-evidence',
        type: 'WAIT_FOR_EVIDENCE',
        priority: 1,
        label: 'Wait for automatic evidence',
        rationale: 'Liquidity sweep',
        blocking: true,
        relatedEvidenceIds: ['evidence:liquiditySweep'],
      },
      {
        id: 'action:confirm-manual-evidence',
        type: 'CONFIRM_MANUAL_EVIDENCE',
        priority: 3,
        label: 'Review manual evidence',
        rationale: 'Entry retest',
        blocking: true,
        relatedEvidenceIds: ['evidence:retestConfirmed'],
      },
    ],
    strategyContext,
    readiness: {
      currentScore: 72,
      requiredScore: 80,
      label: 'Evidence readiness',
      isProbability: false,
    },
    disciplineMessage: 'Follow the strategy conditions and do not force an entry while requirements remain unresolved.',
    fallbackUsed: true,
  });
  assert.equal(narrative.educationalExplanation, undefined);
  assert.equal(narrative.coachingMessage, undefined);
  assert.equal(narrative.learningTip, undefined);
});

test('REJECTED → BLOCK freezes blocking reasons and action precedence', () => {
  const input: TradeInput = { ...completeInput, riskPercent: 1, setupConfidence: 86 };
  const narrative = buildDecisionNarrative({
    result: tradeResult({
      verdict: 'REJECTED',
      score: 84,
      vetoes: ['Risk exceeds 0.5%.'],
      observations: ['Retest remains pending.'],
      overrideAllowed: false,
    }),
    strategy,
    input,
    now: new Date(generatedAt),
  });

  assert.deepEqual(normalized(narrative), {
    version: '1',
    recommendation: 'BLOCK',
    engineVerdict: 'REJECTED',
    source: 'DETERMINISTIC',
    headline: 'BLOCK — do not enter this trade',
    explanation: 'Risk exceeds 0.5%.',
    reasons: [
      {
        id: 'veto:0:risk-exceeds-0-5',
        code: 'ENGINE_VETO',
        category: 'RISK',
        status: 'FAILED',
        origin: 'RISK_ENGINE',
        message: 'Risk exceeds 0.5%.',
        blocking: true,
      },
      {
        id: 'observation:0:retest-remains-pending',
        code: 'ENGINE_OBSERVATION',
        category: 'EVIDENCE',
        status: 'ADVISORY',
        origin: 'RISK_ENGINE',
        message: 'Retest remains pending.',
        blocking: false,
      },
    ],
    missingEvidence: [],
    nextActions: [
      {
        id: 'action:do-not-trade',
        type: 'DO_NOT_TRADE',
        priority: 1,
        label: 'Do not enter this trade',
        rationale: 'One or more deterministic blocking conditions are active.',
        blocking: true,
        relatedEvidenceIds: ['veto:0:risk-exceeds-0-5'],
      },
      {
        id: 'action:review-risk',
        type: 'REVIEW_RISK',
        priority: 2,
        label: 'Review risk controls',
        rationale: 'Resolve the strategy, session, news, or daily-risk restrictions before entry.',
        blocking: true,
        relatedEvidenceIds: ['veto:0:risk-exceeds-0-5'],
      },
    ],
    strategyContext,
    readiness: {
      currentScore: 86,
      requiredScore: 80,
      label: 'Evidence readiness',
      isProbability: false,
    },
    disciplineMessage: 'Follow the strategy conditions and do not force an entry while requirements remain unresolved.',
    fallbackUsed: false,
  });
  assert.equal(narrative.educationalExplanation, undefined);
  assert.equal(narrative.coachingMessage, undefined);
  assert.equal(narrative.learningTip, undefined);
});
