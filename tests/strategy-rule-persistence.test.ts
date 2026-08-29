import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildFinalReviewSummary } from '../lib/final-review-summary.ts';
import { persistedStrategyToV2State, v2StateToPersistedStrategy, type StrategyBuilderV2State } from '../lib/strategy-builder-v2-persistence.ts';
import { normalizePersistableStrategyRules, strategyRulePersistenceRows, type StrategyRuleInput } from '../lib/strategy-rule-persistence.ts';
import { DEFAULT_STRATEGY_PROFILE, type StrategyRule } from '../types/trade.ts';

const baseRule = (label: string, ruleKey?: string | null): StrategyRuleInput => ({
  ruleKey,
  label,
  enabled: true,
  mandatory: true,
  weight: 10,
  minimumConfidence: 60,
  timeframeRole: 'ENTRY',
  evaluationMode: 'AUTOMATIC',
});

test('generated rules missing rule_key receive stable semantic keys while existing keys are preserved', () => {
  const first = normalizePersistableStrategyRules([
    baseRule('H1 Trend Alignment'),
    baseRule('Break of Structure', 'custom-bos-key'),
  ]);
  const second = normalizePersistableStrategyRules(first.rules);
  assert.equal(first.persistable, true);
  assert.deepEqual(first.rules.map((rule) => rule.ruleKey), ['h1-trend-alignment', 'custom-bos-key']);
  assert.deepEqual(second.rules.map((rule) => rule.ruleKey), first.rules.map((rule) => rule.ruleKey));
});

test('multiple generated rules and duplicate candidates are resolved deterministically', () => {
  const input = [baseRule('Liquidity Sweep'), baseRule('Liquidity Sweep'), baseRule('Liquidity Sweep', 'liquidity-sweep')];
  const first = normalizePersistableStrategyRules(input);
  const second = normalizePersistableStrategyRules(input);
  assert.deepEqual(first.rules.map((rule) => rule.ruleKey), ['liquidity-sweep-2', 'liquidity-sweep-3', 'liquidity-sweep']);
  assert.deepEqual(second.rules, first.rules);
});

test('Describe Strategy Beta generated rules survive review, save-row mapping, and reload with non-null rule_key values', () => {
  const state: StrategyBuilderV2State = {
    name: 'XAUUSD Structure Strategy',
    instruments: ['XAUUSD'],
    sessions: ['LONDON'],
    contextTimeframe: 'H1',
    executionTimeframe: 'M15',
    methodologyIds: ['strategy-copilot'],
    ruleSelections: [
      { key: undefined as unknown as string, label: 'Trend Alignment', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'H1', group: 'ALL' },
      { key: undefined as unknown as string, label: 'Break of Structure', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M30', group: 'ALL' },
      { key: undefined as unknown as string, label: 'Retest', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL' },
    ],
    riskPercent: 0.5,
    minimumRR: 2,
  };
  const persisted = v2StateToPersistedStrategy(structuredClone(DEFAULT_STRATEGY_PROFILE), state);
  const review = buildFinalReviewSummary(persisted.profile, persisted.rules, persisted.sessions);
  const rows = strategyRulePersistenceRows(persisted.rules);
  const reloaded = persistedStrategyToV2State(persisted.profile, persisted.rules, persisted.sessions);
  assert.equal(review.readiness, 'Ready for simulated validation');
  assert.equal(review.persistable, true);
  assert.deepEqual(rows.map((row) => row.rule_key), ['trend-alignment', 'break-of-structure', 'retest']);
  assert.deepEqual(reloaded.ruleSelections.map((rule) => rule.key), rows.map((row) => row.rule_key));
  assert.ok(rows.every((row) => row.rule_key.trim()));
});

test('review and persistence reject a rule that cannot receive a semantic key', () => {
  const invalid = { ...baseRule(''), ruleKey: '' } as StrategyRule;
  const normalized = normalizePersistableStrategyRules([invalid]);
  const review = buildFinalReviewSummary({ ...DEFAULT_STRATEGY_PROFILE, id: undefined }, normalized.rules, []);
  assert.equal(normalized.persistable, false);
  assert.equal(review.readiness, 'Rules need review before saving');
  assert.throws(() => strategyRulePersistenceRows(normalized.rules), /Persistence invariant failed/);
});

test('save route sends explicit snake-case rule rows to the atomic RPC', () => {
  const route = readFileSync(new URL('../app/api/strategies/save/route.ts', import.meta.url), 'utf8');
  assert.match(route, /const persistenceRules = strategyRulePersistenceRows\(payload\.rules\)/);
  assert.match(route, /p_rules: persistenceRules/);
  assert.doesNotMatch(route, /p_rules: payload\.rules/);
});
