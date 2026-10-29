import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createRuleComposerModalState,
  dispatchRuleComposerModalClose,
  handleRuleComposerEscapeKey,
  resolveRuleComposerOpener,
  ruleComposerModalReducer,
  scheduleFocusRestore,
  shouldCloseRuleComposerModal,
} from '../lib/rule-composer-modal.ts';
import { TRADING_DNA_RULES } from '../lib/trading-dna/registry.ts';
import { appendComposerNode, composerTreeFromStrategyRules, createComposerCondition, createComposerGroup, deleteComposerNode, duplicateComposerNode, moveComposerNode, strategyRulesFromComposerTree, summarizeComposerTree, updateComposerNode, validateComposerCondition, validateComposerTree, type ComposerCondition } from '../lib/trading-dna/composer.ts';

const rule = (id: string) => {
  const found = TRADING_DNA_RULES.find((item) => item.id === id);
  assert.ok(found, `missing trading DNA rule: ${id}`);
  return found;
};

test('condition creation consumes registry defaults and persists through StrategyRule', () => {
  const condition = createComposerCondition(rule('risk.minimum-rr'), 'rr-1');
  condition.operands = [2];
  const tree = appendComposerNode(createComposerGroup(), 'root', condition);
  const stored = strategyRulesFromComposerTree(tree);
  assert.equal(stored.length, 1);
  assert.match(stored[0].ruleKey, /^dna\.v1\./);
  assert.equal(composerTreeFromStrategyRules(stored).children[0].kind, 'CONDITION');
});

test('conditions can be edited without rule-specific mutation code', () => {
  const condition = createComposerCondition(rule('structure.bos'), 'bos-1');
  const tree = appendComposerNode(createComposerGroup(), 'root', condition);
  const edited = updateComposerNode(tree, 'bos-1', (node) => ({ ...node, inputs: { ...(node as ComposerCondition).inputs, direction: 'BULLISH' } }) as ComposerCondition);
  assert.equal((edited.children[0] as ComposerCondition).inputs.direction, 'BULLISH');
});

test('conditions support duplication deletion and movement', () => {
  let tree = appendComposerNode(createComposerGroup(), 'root', createComposerCondition(rule('structure.bos'), 'a'));
  tree = appendComposerNode(tree, 'root', createComposerCondition(rule('structure.choch'), 'b'));
  tree = duplicateComposerNode(tree, 'a', 'copy');
  assert.deepEqual(tree.children.map((node) => node.id), ['a', 'copy', 'b']);
  tree = moveComposerNode(tree, 'b', -1);
  assert.deepEqual(tree.children.map((node) => node.id), ['a', 'b', 'copy']);
  tree = deleteComposerNode(tree, 'a');
  assert.deepEqual(tree.children.map((node) => node.id), ['b', 'copy']);
});

test('ALL and ANY groups support nested editable trees and round-trip persistence', () => {
  let root = createComposerGroup('root', 'ALL');
  let nested = createComposerGroup('any-1', 'ANY');
  nested = appendComposerNode(nested, 'any-1', createComposerCondition(rule('structure.bos'), 'bos'));
  nested = appendComposerNode(nested, 'any-1', createComposerCondition(rule('structure.choch'), 'choch'));
  root = appendComposerNode(root, 'root', nested);
  root = appendComposerNode(root, 'root', createComposerCondition(rule('session.london'), 'london'));
  const restored = composerTreeFromStrategyRules(strategyRulesFromComposerTree(root));
  assert.equal((restored.children[0] as { logic: string }).logic, 'ANY');
  assert.equal((restored.children[0] as { children: unknown[] }).children.length, 2);
});

test('incomplete dynamic inputs and operator operands prevent saving', () => {
  const ema = createComposerCondition(rule('trend.ema'), 'ema');
  ema.inputs = {};
  assert.ok(validateComposerCondition(ema).some((issue) => issue.message === 'Required input is missing'));
  ema.inputs = { ...rule('trend.ema').defaultValues };
  assert.ok(validateComposerCondition(ema).some((issue) => issue.field === 'operands'));
});

test('contradictory directions in one ALL group produce a warning', () => {
  const bullish = { ...createComposerCondition(rule('structure.bos'), 'bull'), inputs: { ...rule('structure.bos').defaultValues, direction: 'BULLISH' } };
  const bearish = { ...createComposerCondition(rule('structure.bos'), 'bear'), inputs: { ...rule('structure.bos').defaultValues, direction: 'BEARISH' } };
  let tree = appendComposerNode(createComposerGroup(), 'root', bullish);
  tree = appendComposerNode(tree, 'root', bearish);
  assert.ok(validateComposerTree(tree).some((issue) => issue.field === 'children' && issue.message.includes('conflicts')));
});

test('live summary follows nested tree state', () => {
  let tree = appendComposerNode(createComposerGroup(), 'root', createComposerCondition(rule('structure.bos'), 'bos'));
  tree = appendComposerNode(tree, 'root', createComposerGroup('alternatives', 'ANY'));
  const lines = summarizeComposerTree(tree);
  assert.ok(lines.some((line) => line.includes('BOS')));
  assert.ok(lines.some((line) => line.includes('Any of')));
});

test('legacy StrategyRule rows automatically appear without data loss', () => {
  const legacy = { ruleKey: 'bosConfirmed', label: 'Break of Structure', enabled: true, mandatory: true, weight: 25, minimumConfidence: 70, timeframeRole: 'CONFIRMATION' as const, evaluationMode: 'AUTOMATIC' as const };
  const tree = composerTreeFromStrategyRules([legacy]);
  const condition = tree.children[0] as ComposerCondition;
  assert.equal(condition.ruleId, 'structure.bos');
  const stored = strategyRulesFromComposerTree(tree)[0];
  assert.equal(stored.ruleKey, 'bosConfirmed');
  assert.deepEqual({ enabled: stored.enabled, mandatory: stored.mandatory, weight: stored.weight, minimumConfidence: stored.minimumConfidence }, { enabled: true, mandatory: true, weight: 25, minimumConfidence: 70 });
});

test('modal lifecycle reducer covers the close/open contract and tracks the opener focus target', () => {
  const opened = ruleComposerModalReducer(null, { type: 'OPEN', targetGroupId: 'root', triggerId: 'add-condition-trigger-root', openerId: 'add-condition-trigger-root' });
  assert.ok(opened);
  assert.equal(opened?.step, 1);
  assert.equal(opened?.triggerId, 'add-condition-trigger-root');
  assert.equal(opened?.openerId, 'add-condition-trigger-root');

  const rerendered = ruleComposerModalReducer(opened, { type: 'RERENDER' });
  assert.deepEqual(rerendered, opened);

  const reset = ruleComposerModalReducer(opened, { type: 'RESET' });
  assert.equal(reset?.step, 1);
  assert.equal(reset?.condition, undefined);
  assert.equal(reset?.category, undefined);
  assert.equal(reset?.editing, false);

  const closed = ruleComposerModalReducer(opened, { type: 'CLOSE' });
  assert.equal(closed, null);

  const sameOpenState = ruleComposerModalReducer(opened, { type: 'OPEN', targetGroupId: 'root' });
  assert.deepEqual(sameOpenState, opened);

  for (const step of [1, 2, 3, 4, 5, 6]) {
    const state = createRuleComposerModalState('root', step, { triggerId: `step-${step}` });
    assert.equal(ruleComposerModalReducer(state, { type: 'CLOSE' }), null);
  }

  const reopened = ruleComposerModalReducer(null, { type: 'OPEN', targetGroupId: 'root' });
  assert.equal(reopened?.step, 1);
  assert.equal(reopened?.triggerId, undefined);
  assert.equal(reopened?.openerId, undefined);
});

test('modal reducer keeps the selected category and draft condition state consistent through edits', () => {
  const base = createRuleComposerModalState('root', 1, { triggerId: 'add-condition-trigger-root' });
  const withCategory = ruleComposerModalReducer(base, { type: 'SET_CATEGORY', category: 'TREND' });
  assert.equal(withCategory?.category, 'TREND');
  assert.equal(withCategory?.step, 3);

  const condition = createComposerCondition(TRADING_DNA_RULES[0], 'condition-1');
  const withCondition = ruleComposerModalReducer(withCategory, { type: 'SET_CONDITION', condition });
  assert.equal(withCondition?.condition?.id, 'condition-1');
  assert.equal(withCondition?.step, 4);

  const nextStep = ruleComposerModalReducer(withCondition, { type: 'SET_STEP', step: 5 });
  assert.equal(nextStep?.step, 5);
});

test('focus restoration helpers resolve the opener and only close when the backdrop target matches the modal root', () => {
  const focusTarget = { id: 'rule-composer-trigger', focus() {} };
  const opener = resolveRuleComposerOpener('rule-composer-trigger', focusTarget);
  assert.equal(opener, 'rule-composer-trigger');

  const backdropTarget = {} as EventTarget;
  const backdrop = { target: backdropTarget, currentTarget: backdropTarget };
  const innerTarget = {} as EventTarget;
  const inner = { target: innerTarget, currentTarget: {} as EventTarget };
  assert.equal(shouldCloseRuleComposerModal(backdrop), true);
  assert.equal(shouldCloseRuleComposerModal(inner), false);

  const focusCalls: string[] = [];
  const target = { focus: () => focusCalls.push('focused') };
  scheduleFocusRestore(target);
  assert.ok(focusCalls.length >= 0);
});

test('rerender while closed remains closed and cannot recreate the modal without a fresh open action', () => {
  const opened = ruleComposerModalReducer(null, { type: 'OPEN', targetGroupId: 'root', triggerId: 'add-condition-trigger-root', openerId: 'add-condition-trigger-root' });
  const closed = ruleComposerModalReducer(opened, { type: 'CLOSE' });
  assert.equal(closed, null);

  const rerenderWhileClosed = ruleComposerModalReducer(closed, { type: 'RERENDER' });
  assert.equal(rerenderWhileClosed, null);

  const freshOpen = ruleComposerModalReducer(null, { type: 'OPEN', targetGroupId: 'root', triggerId: 'fresh-trigger', openerId: 'fresh-trigger' });
  assert.ok(freshOpen);
  assert.equal(freshOpen?.step, 1);
  assert.equal(freshOpen?.triggerId, 'fresh-trigger');
});

test('stale trigger state cannot reopen after close and only a fresh OPEN action can recreate the modal', () => {
  const opened = ruleComposerModalReducer(null, { type: 'OPEN', targetGroupId: 'root', triggerId: 'stale-trigger', openerId: 'stale-trigger' });
  const closed = ruleComposerModalReducer(opened, { type: 'CLOSE' });
  assert.equal(closed, null);

  const actions: Array<{ type: string }> = [];
  const backdropTarget = {} as EventTarget;
  const closeHandled = dispatchRuleComposerModalClose({ target: backdropTarget, currentTarget: backdropTarget }, (action) => actions.push(action));
  assert.equal(closeHandled, true);
  assert.deepEqual(actions, [{ type: 'CLOSE' }]);

  const rerenderStillClosed = ruleComposerModalReducer(closed, { type: 'RERENDER' });
  assert.equal(rerenderStillClosed, null);

  const explicitReopen = ruleComposerModalReducer(null, { type: 'OPEN', targetGroupId: 'root', triggerId: 'fresh-trigger', openerId: 'fresh-trigger' });
  assert.ok(explicitReopen);
  assert.equal(explicitReopen?.openerId, 'fresh-trigger');
});

test('escape closes behaviorally and non-Escape keys do not close', () => {
  let closed = false;
  let preventDefaultCalled = false;
  let stopPropagationCalled = false;

  const escapeEvent = {
    key: 'Escape',
    preventDefault: () => { preventDefaultCalled = true; },
    stopPropagation: () => { stopPropagationCalled = true; },
  };

  assert.equal(handleRuleComposerEscapeKey(escapeEvent, true, () => { closed = true; }), true);
  assert.equal(closed, true);
  assert.equal(preventDefaultCalled, true);
  assert.equal(stopPropagationCalled, true);

  closed = false;
  preventDefaultCalled = false;
  stopPropagationCalled = false;

  const nonEscapeEvent = {
    key: 'Tab',
    preventDefault: () => { preventDefaultCalled = true; },
    stopPropagation: () => { stopPropagationCalled = true; },
  };

  assert.equal(handleRuleComposerEscapeKey(nonEscapeEvent, true, () => { closed = true; }), false);
  assert.equal(closed, false);
  assert.equal(preventDefaultCalled, false);
  assert.equal(stopPropagationCalled, false);
});

test('internal click keeps the modal open while backdrop click closes', () => {
  const rootTarget = {} as EventTarget;
  const innerTarget = {} as EventTarget;

  const backdropActions: Array<{ type: string }> = [];
  const backdropHandled = dispatchRuleComposerModalClose({ target: rootTarget, currentTarget: rootTarget }, (action) => backdropActions.push(action));
  assert.equal(backdropHandled, true);
  assert.deepEqual(backdropActions, [{ type: 'CLOSE' }]);

  const innerActions: Array<{ type: string }> = [];
  const innerHandled = dispatchRuleComposerModalClose({ target: innerTarget, currentTarget: rootTarget }, (action) => innerActions.push(action));
  assert.equal(innerHandled, false);
  assert.deepEqual(innerActions, []);
});

test('modal close and source contract keep the saved tree unchanged and expose the accessible dialog hooks', () => {
  const source = readFileSync(new URL('../components/RuleComposer.tsx', import.meta.url), 'utf8');
  const tree = appendComposerNode(createComposerGroup(), 'root', createComposerCondition(TRADING_DNA_RULES[0], 'preexisting'));
  const before = JSON.stringify(tree);

  const opened = ruleComposerModalReducer(null, { type: 'OPEN', targetGroupId: 'root', triggerId: 'add-condition-trigger-root' });
  const closed = ruleComposerModalReducer(opened, { type: 'CLOSE' });
  assert.equal(closed, null);
  assert.equal(JSON.stringify(tree), before);

  assert.match(source, /onKeyDown=.*Escape/);
  assert.match(source, /shouldCloseRuleComposerModal/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-label="Close Add Condition"/);
  assert.match(source, /onMouseDown=\{\(event\)=>event\.stopPropagation\(\)\}/);
  assert.match(source, /scheduleFocusRestore\(nextFocus\)/);
});
