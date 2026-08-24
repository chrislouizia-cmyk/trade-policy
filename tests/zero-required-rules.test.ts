import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_STRATEGY_PROFILE, type StrategyProfile, type StrategyRule } from '../types/trade.ts';
import { assertUsableRequiredRules, deriveRequiredEvidence } from '../lib/strategy-policy.ts';

const rule = (
  ruleKey: string,
  mandatory: boolean,
  weight = 10,
  evaluationMode: StrategyRule['evaluationMode'] = 'AUTOMATIC',
): StrategyRule => ({
  ruleKey,
  label: ruleKey,
  enabled: true,
  mandatory,
  weight,
  minimumConfidence: 60,
  timeframeRole: 'ENTRY',
  evaluationMode,
});

const profile = (rules: StrategyRule[]): StrategyProfile => ({
  ...DEFAULT_STRATEGY_PROFILE,
  rules,
  requiredEvidence: deriveRequiredEvidence(rules, DEFAULT_STRATEGY_PROFILE.evidenceWeights),
  evidenceWeights: { ...DEFAULT_STRATEGY_PROFILE.evidenceWeights },
});

test('required-evidence derivation ignores optional-only legacy configuration', () => {
  const result = deriveRequiredEvidence([
    rule('h4TrendAligned', false),
    rule('h1TrendAligned', false),
    rule('liquiditySweep', false),
  ], DEFAULT_STRATEGY_PROFILE.evidenceWeights);

  assert.deepEqual(result, []);
});

test('strategy validation rejects zero usable required rules before activation or save', () => {
  const strategy = profile([
    rule('h4TrendAligned', false),
    rule('h1TrendAligned', false),
    rule('liquiditySweep', false),
  ]);

  assert.throws(
    () => assertUsableRequiredRules(strategy),
    /Strategy setup required/i,
  );
});

test('supported mandatory rules still satisfy the contract', () => {
  const strategy = profile([
    rule('h4TrendAligned', true),
    rule('h1TrendAligned', true),
    rule('liquiditySweep', true),
  ]);

  assert.doesNotThrow(() => assertUsableRequiredRules(strategy));
  assert.deepEqual(strategy.requiredEvidence, ['h4TrendAligned', 'h1TrendAligned', 'liquiditySweep']);
});
