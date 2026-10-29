import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STRATEGY_PROFILE } from '../types/trade.ts';
import {
  buildCanonicalStrategyReview,
  canonicalDraftForVisibleV2Review,
  confirmCanonicalStrategyReview,
  persistedStrategyFromCurrentReview,
} from '../lib/strategy-creation-review.ts';
import { updateCanonicalCreationDraft } from '../lib/strategy-creation-contract.ts';
import { createPersistedV2RuleTree } from '../lib/strategy-builder-v2.ts';

const rule = {
  key: 'trend-alignment', label: 'Trend alignment', capability: 'AUTOMATIC' as const,
  requirement: 'REQUIRED' as const, timeframe: 'H1', group: 'ANY' as const,
  description: 'Trend agrees with the setup.',
};
const values = {
  name: 'London discipline', instruments: ['EURUSD'], sessions: ['LONDON'],
  contextTimeframe: 'H4', executionTimeframe: 'H1', methodologyIds: ['smc'],
  ruleSelections: [rule], ruleTree: createPersistedV2RuleTree([rule]),
  riskPercent: 0.5, minimumRR: 2, stopLogic: 'Beyond structure', targetLogic: 'Next liquidity',
  direction: 'LONG' as const,
};

test('canonical review describes the exact adapter input and explicit activation intent', () => {
  const base = { ...DEFAULT_STRATEGY_PROFILE, id: undefined, isDefault: true };
  const draft = canonicalDraftForVisibleV2Review({ intent: 'CREATE', values });
  const review = buildCanonicalStrategyReview(base, draft);
  const confirmation = confirmCanonicalStrategyReview(base, draft);
  const persisted = persistedStrategyFromCurrentReview(base, draft, confirmation);
  assert.equal(review.operation, 'CREATE');
  assert.equal(review.activationIntent, 'ACTIVATE');
  assert.deepEqual(review.conditions.map(({ requirement, relationship, capability }) => ({ requirement, relationship, capability })), [
    { requirement: 'REQUIRED', relationship: 'ANY', capability: 'AUTOMATIC' },
  ]);
  assert.equal(persisted.profile.name, review.name);
  assert.deepEqual(persisted.profile.instruments, review.instruments);
  assert.equal(persisted.profile.isDefault, true);
});

test('opening review does not confirm inferred sensitive values', () => {
  const base = { ...DEFAULT_STRATEGY_PROFILE, id: undefined };
  const draft = canonicalDraftForVisibleV2Review({ intent: 'CREATE', values, provenance: 'INFERRED' });
  buildCanonicalStrategyReview(base, draft);
  assert.equal(draft.reviewConfirmed, false);
  assert.equal(draft.state, 'READY_FOR_REVIEW');
});

test('changed sensitive data makes a prior confirmation stale and blocks save', () => {
  const base = { ...DEFAULT_STRATEGY_PROFILE, id: undefined };
  const draft = canonicalDraftForVisibleV2Review({ intent: 'CREATE', values });
  const confirmation = confirmCanonicalStrategyReview(base, draft);
  const changed = updateCanonicalCreationDraft(draft, { riskPercent: 1 }, { riskPercent: 'EXPLICIT' });
  assert.throws(() => persistedStrategyFromCurrentReview(base, changed, confirmation), /changed after review/);
});

test('edit keeps the selected identity and duplicate creation cannot reuse it', () => {
  const base = { ...DEFAULT_STRATEGY_PROFILE, id: 'strategy-selected', isDefault: false };
  const edit = canonicalDraftForVisibleV2Review({ intent: 'EDIT', strategyId: base.id, values });
  const persisted = persistedStrategyFromCurrentReview(base, edit, confirmCanonicalStrategyReview(base, edit));
  assert.equal(persisted.profile.id, 'strategy-selected');
  const duplicateBase = { ...base, id: undefined };
  const duplicate = canonicalDraftForVisibleV2Review({ intent: 'CREATE', values: { ...values, name: 'London discipline Copy' } });
  const copy = persistedStrategyFromCurrentReview(duplicateBase, duplicate, confirmCanonicalStrategyReview(duplicateBase, duplicate));
  assert.equal(copy.profile.id, undefined);
});

test('review preserves required/optional, ALL/ANY and every evaluation capability', () => {
  const capabilities = ['AUTOMATIC', 'MANUAL', 'EXTERNAL', 'DESCRIPTIVE'] as const;
  const keys = ['trend-alignment', 'support-zone', 'session-open', 'custom-rule'];
  const rules = capabilities.map((capability, index) => ({
    ...rule,
    key: keys[index],
    label: capability,
    capability,
    requirement: capability === 'AUTOMATIC' ? 'REQUIRED' as const : 'OPTIONAL' as const,
    group: index % 2 ? 'ALL' as const : 'ANY' as const,
  }));
  const draft = canonicalDraftForVisibleV2Review({ intent: 'CREATE', values: { ...values, ruleSelections: rules, ruleTree: undefined } });
  const review = buildCanonicalStrategyReview(DEFAULT_STRATEGY_PROFILE, draft);
  assert.deepEqual(review.conditions.map(({ requirement, relationship, capability }) => [requirement, relationship, capability]), rules.map((item) => [item.requirement, item.group, item.capability]));
});
