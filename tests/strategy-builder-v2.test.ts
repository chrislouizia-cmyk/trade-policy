import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METHODOLOGY_LIBRARY,
  buildDraftFromSelection,
  buildHealthSummary,
  createDefaultRuleSelection,
  detectStrategyConflicts,
  parseCopilotPrompt,
  safeDescriptiveState,
  toPersistedExecutionMode,
} from '../lib/strategy-builder-v2.ts';

import { createPersistedV2RuleTree, type RuleSelection } from '../lib/strategy-builder-v2.ts';

test('V2 exposes the required methodologies and rule libraries', () => {
  const ids = METHODOLOGY_LIBRARY.map((library) => library.id);
  assert.ok(ids.includes('smc'));
  assert.ok(ids.includes('ict'));
  assert.ok(ids.includes('support-resistance'));
  assert.ok(ids.includes('supply-demand'));
  assert.ok(ids.includes('price-action'));
  assert.ok(ids.includes('breakouts'));
  assert.ok(ids.includes('trend-following'));
  assert.ok(ids.includes('momentum'));
  assert.ok(ids.includes('mean-reversion'));
  assert.ok(ids.includes('volume'));
  assert.ok(ids.includes('custom'));
});

test('V2 draft keeps methodology subsets and required vs optional state', () => {
  const defaultRules = createDefaultRuleSelection();
  const draft = buildDraftFromSelection(['smc', 'support-resistance'], ['liquidity-sweep', 'choch', 'support-zone'], defaultRules);

  assert.equal(draft.methodologies.length, 2);
  assert.ok(draft.rules.some((rule) => rule.key === 'liquidity-sweep' && rule.requirement === 'REQUIRED'));
  assert.ok(draft.rules.some((rule) => rule.key === 'support-zone' && rule.requirement === 'REQUIRED'));
});

test('ALL and ANY persistence stays in the structured rule draft', () => {
  const draft = buildDraftFromSelection(['smc'], ['liquidity-sweep', 'choch', 'order-block', 'fair-value-gap'], [
    { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL', description: 'sweep' },
    { key: 'choch', label: 'CHoCH', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL', description: 'choch' },
    { key: 'order-block', label: 'Order Block', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'ob' },
    { key: 'fair-value-gap', label: 'Fair Value Gap', capability: 'AUTOMATIC', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'fvg' },
  ] satisfies RuleSelection[]);

  assert.ok(draft.rules.every((rule) => rule.group === 'ALL' || rule.group === 'ANY'));
  assert.ok(draft.rules.some((rule) => rule.key === 'order-block' && rule.group === 'ANY'));
  assert.ok(draft.rules.some((rule) => rule.key === 'liquidity-sweep' && rule.group === 'ALL'));
});

test('V2 UI rule tree persists A AND (B OR C) as nested ALL/ANY structure', () => {
  const tree = createPersistedV2RuleTree([
    { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL', description: 'sweep' },
    { key: 'choch', label: 'CHoCH', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL', description: 'choch' },
    { key: 'order-block', label: 'Order Block', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'ob' },
    { key: 'support-zone', label: 'Support Zone', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'support-zone' },
  ] satisfies RuleSelection[]);

  assert.equal(tree.logic, 'ALL');
  assert.equal(tree.children.length, 3);
  assert.equal(tree.children[2].kind, 'GROUP');
  if (tree.children[2].kind === 'GROUP') {
    assert.equal(tree.children[2].logic, 'ANY');
    assert.equal(tree.children[2].children.length, 2);
  }
});

test('strategy conflicts detect duplicate and directional contradictions', () => {
  const conflicts = detectStrategyConflicts({
    selectedRules: [
      { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL' },
      { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL' },
      { key: 'trend-alignment', label: 'Trend Alignment', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'H4', group: 'ALL' },
      { key: 'bos', label: 'BOS', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL' },
    ] satisfies RuleSelection[],
    riskPercent: 12,
    minimumRR: 0,
  });

  assert.ok(conflicts.some((conflict) => conflict.id === 'duplicate-liquidity-sweep'));
  assert.ok(conflicts.some((conflict) => conflict.id === 'directional-conflict'));
  assert.ok(conflicts.some((conflict) => conflict.id === 'risk-value'));
  assert.ok(conflicts.some((conflict) => conflict.id === 'rr-value'));
});

test('descriptive rules persist safely without masquerading as automatic', () => {
  const mapped = safeDescriptiveState('custom-rule', 'DESCRIPTIVE');
  assert.equal(mapped.capability, 'DESCRIPTIVE');
  assert.equal(mapped.evaluationMode, 'MANUAL');
  assert.equal(mapped.isDescriptive, true);
  assert.equal(toPersistedExecutionMode('DESCRIPTIVE'), 'MANUAL');
});

test('copilot parsing recognizes OR logic and unknown concepts', () => {
  const parsed = parseCopilotPrompt('I trade XAUUSD. Liquidity Sweep and CHoCH. Either Order Block or FVG is enough. Weekly manipulation leg seems important.');

  assert.ok(parsed.selectedRuleKeys.includes('liquidity-sweep'));
  assert.ok(parsed.selectedRuleKeys.includes('choch'));
  assert.ok(parsed.selectedRuleKeys.includes('order-block'));
  assert.ok(parsed.selectedRuleKeys.includes('fair-value-gap'));
  assert.equal(parsed.groupMode, 'ANY');
  assert.ok(parsed.unknownConcepts.includes('weekly manipulation leg'));
});

test('V2 accepts one methodology and a selected subset without attaching unrelated rules', () => {
  const draft = buildDraftFromSelection(['smc'], ['liquidity-sweep', 'choch'], []);

  assert.equal(draft.methodologies.length, 1);
  assert.deepEqual(draft.methodologies[0].rules, ['liquidity-sweep', 'choch']);
  assert.ok(draft.rules.every((rule) => ['liquidity-sweep', 'choch'].includes(rule.key)));
});

test('V2 accepts multiple methodologies and preserves subset rules through the draft', () => {
  const draft = buildDraftFromSelection(['smc', 'support-resistance'], ['liquidity-sweep', 'support-zone'], []);

  assert.equal(draft.methodologies.length, 2);
  assert.ok(draft.rules.some((rule) => rule.key === 'liquidity-sweep'));
  assert.ok(draft.rules.some((rule) => rule.key === 'support-zone'));
  assert.ok(draft.rules.every((rule) => ['liquidity-sweep', 'support-zone'].includes(rule.key)));
});

test('timeframe persistence survives a methodology draft reload', () => {
  const draft = buildDraftFromSelection(['smc'], ['liquidity-sweep'], [{
    key: 'liquidity-sweep',
    label: 'Liquidity Sweep',
    capability: 'AUTOMATIC',
    requirement: 'REQUIRED',
    timeframe: 'H1',
    group: 'ALL',
    description: 'sweep',
  } satisfies RuleSelection]);

  assert.equal(draft.rules[0].timeframe, 'H1');
  assert.equal(draft.rules[0].group, 'ALL');
});

test('required rules become mandatory and optional rules stay optional', () => {
  const draft = buildDraftFromSelection(['smc', 'custom'], ['liquidity-sweep', 'custom-rule'], [
    { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL', description: 'sweep' },
    { key: 'custom-rule', label: 'Custom Rule', capability: 'DESCRIPTIVE', requirement: 'OPTIONAL', timeframe: 'M15', group: 'ALL', description: 'custom' },
  ] satisfies RuleSelection[]);

  assert.ok(draft.rules.some((rule) => rule.key === 'liquidity-sweep' && rule.requirement === 'REQUIRED'));
  assert.ok(draft.rules.some((rule) => rule.key === 'custom-rule' && rule.requirement === 'OPTIONAL'));
});

test('DESCRIPTIVE rules remain informational and cannot create a mandatory requirement', () => {
  const draft = buildDraftFromSelection(['custom'], ['custom-rule'], [
    { key: 'custom-rule', label: 'Custom Rule', capability: 'DESCRIPTIVE', requirement: 'OPTIONAL', timeframe: 'M15', group: 'ALL', description: 'custom' },
  ] satisfies RuleSelection[]);
  const state = safeDescriptiveState('custom-rule', 'DESCRIPTIVE');

  assert.equal(draft.rules[0].capability, 'DESCRIPTIVE');
  assert.equal(draft.rules[0].requirement, 'OPTIONAL');
  assert.equal(state.capability, 'DESCRIPTIVE');
  assert.equal(state.isDescriptive, true);
  assert.equal(state.evaluationMode, 'MANUAL');
  assert.notEqual(draft.rules[0].requirement, 'REQUIRED');
  assert.equal(toPersistedExecutionMode('DESCRIPTIVE'), 'MANUAL');
});

test('DESCRIPTIVE selection does not block eligibility, create WAIT/BLOCKED, or prevent READY', () => {
  const draft = buildDraftFromSelection(['custom'], ['custom-rule'], [
    { key: 'custom-rule', label: 'Custom Rule', capability: 'DESCRIPTIVE', requirement: 'OPTIONAL', timeframe: 'M15', group: 'ALL', description: 'custom' },
  ] satisfies RuleSelection[]);

  assert.equal(draft.rules[0].requirement, 'OPTIONAL');
  assert.equal(draft.rules[0].capability, 'DESCRIPTIVE');
  assert.equal(toPersistedExecutionMode('DESCRIPTIVE'), 'MANUAL');
  assert.ok(!draft.rules.some((rule) => rule.requirement === 'REQUIRED' && rule.capability === 'DESCRIPTIVE'));
});

test('V2 save/reload semantics are stable for the persisted tree and rule selection', () => {
  const source = [
    { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL', description: 'sweep' },
    { key: 'order-block', label: 'Order Block', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'ob' },
    { key: 'support-zone', label: 'Support Zone', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'support' },
  ] satisfies RuleSelection[];

  const persisted = createPersistedV2RuleTree(source);
  const reloaded = createPersistedV2RuleTree(source);
  assert.deepEqual(persisted, reloaded);
  assert.equal(persisted.logic, 'ALL');
  assert.ok(persisted.children.some((child) => child.kind === 'GROUP' && child.logic === 'ANY'));
});

test('legacy strategies without methodology metadata are not silently attached to a methodology', () => {
  const legacySelection = [
    { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL', description: 'legacy' },
  ] satisfies RuleSelection[];
  const draft = buildDraftFromSelection([], ['liquidity-sweep'], legacySelection);

  assert.equal(draft.methodologies.length, 0);
  assert.equal(draft.rules[0].key, 'liquidity-sweep');
  assert.equal(draft.rules[0].requirement, 'REQUIRED');
});

test('existing ALL/ANY group preservation survives rule-tree persistence exactly as configured', () => {
  const source = [
    { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL', description: 'sweep' },
    { key: 'choch', label: 'CHoCH', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL', description: 'choch' },
    { key: 'order-block', label: 'Order Block', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'ob' },
    { key: 'support-zone', label: 'Support Zone', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'support' },
  ] satisfies RuleSelection[];
  const tree = createPersistedV2RuleTree(source);

  const allGroupCount = tree.children.filter((child) => child.kind === 'CONDITION').length;
  const anyGroup = tree.children.find((child) => child.kind === 'GROUP' && child.logic === 'ANY');

  assert.equal(allGroupCount, 2);
  assert.ok(anyGroup && anyGroup.kind === 'GROUP');
  if (anyGroup && anyGroup.kind === 'GROUP') {
    assert.equal(anyGroup.children.length, 2);
    assert.ok(anyGroup.children.every((child) => child.kind === 'CONDITION'));
  }
});

test('health summary counts rules and unresolved conflicts', () => {
  const rules = [
    { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL' },
    { key: 'custom-rule', label: 'Custom Rule', capability: 'DESCRIPTIVE', requirement: 'OPTIONAL', timeframe: 'M15', group: 'ALL' },
  ] satisfies RuleSelection[];
  const conflicts = detectStrategyConflicts({ selectedRules: rules, riskPercent: 1, minimumRR: 3 });
  const summary = buildHealthSummary({ selectedRules: rules, conflicts });

  assert.equal(summary.totalRules, 2);
  assert.equal(summary.automatic, 1);
  assert.equal(summary.descriptive, 1);
  assert.equal(summary.required, 1);
  assert.equal(summary.optional, 1);
});
