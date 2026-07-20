import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  getAiDockStatus,
  getDecisionHeroState,
  getReadinessInterpretation,
} from '../lib/decision-hero.ts';
import { DEFAULT_STRATEGY_PROFILE, type ChartAnalysis } from '../types/trade.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

function baseAnalysis(overrides: Partial<ChartAnalysis> = {}): ChartAnalysis {
  return {
    status: 'VALID_ANALYSIS',
    analysisStatus: 'VALID_ANALYSIS',
    instrument: 'XAUUSD',
    timeframe: 'H4/H1/M30',
    strategyId: 'strategy-a',
    provider: 'fixture',
    calculatedAt: new Date().toISOString(),
    latestCandleTimestamp: new Date().toISOString(),
    detectedTimeframes: ['H4', 'H1', 'M30'],
    h4Bias: 'BULLISH',
    h1Bias: 'BULLISH',
    suggestedDirection: 'BUY',
    setupType: 'Liquidity Sweep + ChoCH + BoS',
    liveAnalysisConfidence: 62,
    strategyConfidenceThreshold: 75,
    evidence: (Object.keys(DEFAULT_STRATEGY_PROFILE.evidenceWeights) as Array<keyof ChartAnalysis['evidence']>).reduce((acc, key) => {
      acc[key] = { value: true, confidence: 80, reason: 'fixture' };
      return acc;
    }, {} as ChartAnalysis['evidence']),
    candidates: [{ id: 'c1', direction: 'BUY', entryLow: 1, entryHigh: 1, stopLoss: 0.9, takeProfit: 1.3, rr: 3, status: 'WAIT', rationale: 'fixture' }],
    warnings: [],
    summary: 'fixture',
    ...overrides,
  };
}

test('Decision Hero component exists in validate workspace', () => {
  const tradeValidator = readFileSync(`${root}/components/TradeValidator.tsx`, 'utf8');
  const decisionHero = readFileSync(`${root}/components/decision/DecisionHero.tsx`, 'utf8');
  assert.match(tradeValidator, /import DecisionHero from '@\/components\/decision\/DecisionHero'/);
  assert.match(tradeValidator, /<DecisionHero/);
  assert.match(decisionHero, /export default function DecisionHero/);
});

test('visible decision UI uses Readiness instead of Confidence', () => {
  const tradeValidator = readFileSync(`${root}/components/TradeValidator.tsx`, 'utf8');
  const decisionHero = readFileSync(`${root}/components/decision/DecisionHero.tsx`, 'utf8');
  const livePanel = readFileSync(`${root}/components/LiveMarketPanel.tsx`, 'utf8');

  assert.match(decisionHero, />Readiness</);
  assert.match(decisionHero, />Required readiness</);
  assert.match(tradeValidator, />Readiness</);
  assert.match(tradeValidator, />Setup readiness/);
  assert.match(tradeValidator, />Required readiness/);
  assert.match(livePanel, />Setup readiness/);
  assert.match(livePanel, />Required readiness/);
  assert.doesNotMatch(tradeValidator, />Confidence</);
  assert.doesNotMatch(decisionHero, />Confidence</);
});

test('Decision Report replaces Trade Reasoning in user-facing copy', () => {
  const tradeValidator = readFileSync(`${root}/components/TradeValidator.tsx`, 'utf8');
  const decisionHero = readFileSync(`${root}/components/decision/DecisionHero.tsx`, 'utf8');

  assert.match(tradeValidator, />DECISION REPORT</);
  assert.match(tradeValidator, />View Decision Report</);
  assert.match(decisionHero, />View Decision Report</);
  assert.match(
    tradeValidator,
    /What Trade Police detected, what your strategy requires, and what happens next\./,
  );
  assert.doesNotMatch(tradeValidator, />TRADE REASONING</);
  assert.doesNotMatch(tradeValidator, />View Trade Reasoning</);
});

test('low readiness does not render Analysis unavailable', () => {
  const analysis = baseAnalysis({ liveAnalysisConfidence: 42 });
  const interpretation = getReadinessInterpretation(analysis, 75);
  assert.equal(interpretation, 'Below required readiness');
  assert.notEqual(interpretation, 'Analysis unavailable');

  const tradeValidator = readFileSync(`${root}/components/TradeValidator.tsx`, 'utf8');
  assert.doesNotMatch(tradeValidator, /Analysis unavailable/);
});

test('deterministic verdict logic remains unchanged through shared dock status', () => {
  const threshold = 75;
  const analysis = baseAnalysis();

  assert.deepEqual(getAiDockStatus({ analyzing: true, analysis: null, result: null, threshold }), {
    label: 'ANALYZING',
    detail: 'Reading configured timeframes.',
    variant: 'info',
  });
  assert.deepEqual(getAiDockStatus({ analyzing: false, analysis: null, result: null, threshold }), {
    label: 'WATCHING MARKET',
    detail: 'Ready for live analysis.',
    variant: 'neutral',
  });
  assert.deepEqual(getAiDockStatus({
    analyzing: false,
    analysis,
    result: { verdict: 'AUTHORIZED' } as any,
    threshold,
  }), {
    label: 'READY',
    detail: 'The validation engine approved the setup.',
    variant: 'positive',
  });
  assert.deepEqual(getAiDockStatus({
    analyzing: false,
    analysis,
    result: { verdict: 'REJECTED' } as any,
    threshold,
  }), {
    label: 'BLOCKED',
    detail: 'A policy condition failed.',
    variant: 'warning',
  });
  assert.deepEqual(getAiDockStatus({
    analyzing: false,
    analysis,
    result: null,
    threshold,
  }), {
    label: 'WAIT',
    detail: 'Confirmation is incomplete.',
    variant: 'warning',
  });
});

test('decision hero maps deterministic states to primary verdicts', () => {
  const threshold = 75;

  assert.equal(getDecisionHeroState({ analyzing: true, analysis: null, result: null, threshold }).verdict, 'ANALYZING');
  assert.equal(getDecisionHeroState({
    analyzing: false,
    analysis: baseAnalysis({ status: 'NO_RELEVANT_EVIDENCE', analysisStatus: 'NO_RELEVANT_EVIDENCE', liveAnalysisConfidence: null }),
    result: null,
    threshold,
  }).verdict, 'NO SETUP');
  assert.equal(getDecisionHeroState({
    analyzing: false,
    analysis: baseAnalysis({ status: 'DATA_UNAVAILABLE', analysisStatus: 'DATA_UNAVAILABLE', liveAnalysisConfidence: null }),
    result: null,
    threshold,
  }).verdict, 'DATA UNAVAILABLE');
  assert.equal(getDecisionHeroState({
    analyzing: false,
    analysis: baseAnalysis({ candidates: [{ ...baseAnalysis().candidates[0], status: 'READY' }] }),
    result: null,
    threshold: 40,
  }).verdict, 'READY');
});

test('Analyze page is framed around the trade decision question', () => {
  const page = readFileSync(`${root}/app/validate/page.tsx`, 'utf8');
  assert.match(page, /TRADE POLICE \/ ANALYZE/);
  assert.match(page, /Should I take this trade\?/);
  assert.doesNotMatch(page, /VALIDATION DESK/);
});

test('Analyze consumes the additive Decision Narrative contract without recreating backend logic', () => {
  const tradeValidator = readFileSync(`${root}/components/TradeValidator.tsx`, 'utf8');
  const decisionHero = readFileSync(`${root}/components/decision/DecisionHero.tsx`, 'utf8');

  assert.match(tradeValidator, /result\?\.decisionNarrative/);
  assert.match(tradeValidator, /narrative\.reasons\.map/);
  assert.match(tradeValidator, /narrative\.missingEvidence\.map/);
  assert.match(tradeValidator, /narrative\.nextActions\.map/);
  assert.match(tradeValidator, /educationalExplanation/);
  assert.match(decisionHero, /SHOULD I TAKE THIS TRADE\?/);
  assert.match(decisionHero, /narrative\?\.recommendation/);
  assert.doesNotMatch(tradeValidator, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(decisionHero, /dangerouslySetInnerHTML/);
});
