import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METHODOLOGY_LIBRARY,
  buildDraftFromSelection,
  buildHealthSummary,
  createDefaultRuleSelection,
  detectStrategyConflicts,
  parseCopilotPrompt,
  reconcileRuleSelectionsWithMethodologies,
  safeDescriptiveState,
  toPersistedExecutionMode,
} from '../lib/strategy-builder-v2.ts';

import { createPersistedV2RuleTree, type RuleSelection } from '../lib/strategy-builder-v2.ts';
import { persistedStrategyToV2State, v2StateToPersistedStrategy } from '../lib/strategy-builder-v2-persistence.ts';
import { canReviewStrategyDraft, emptyStrategyCopilotDraft, extractStructuredDraftFromText, hasGeneratedStrategyDraft, mergeStrategyCopilotDraft, normalizeStrategyCopilotReply, type StrategyCopilotDraft } from '../lib/strategy-copilot.ts';
import { resolveBuilderEntryMode } from '../lib/strategy-builder-entry.ts';
import { STRATEGY_CREATION_MODE_LABELS, canReachFinalReviewDirectlyFromSelector, getStrategyCreationModes } from '../lib/strategy-creation-flow.ts';
import { DEFAULT_STRATEGY_PROFILE, type EvidenceKey } from '../types/trade.ts';
import { assertUsableRequiredRules, deriveRequiredEvidence, ZeroRequiredRulesError } from '../lib/strategy-policy.ts';

test('new strategy entry routes into the V2 builder while existing profiles stay on compatibility mode', () => {
  assert.equal(resolveBuilderEntryMode({ existingStrategyId: null, isNewStrategyRequest: true }), true);
  assert.equal(resolveBuilderEntryMode({ existingStrategyId: 'abc123', isNewStrategyRequest: true }), false);
  assert.equal(resolveBuilderEntryMode({ existingStrategyId: null, isNewStrategyRequest: false }), false);
});

test('copilot refinement lifecycle requires an initial draft before refinement and keeps review available', () => {
  const empty = emptyStrategyCopilotDraft();
  assert.equal(hasGeneratedStrategyDraft(empty), false);
  assert.equal(canReviewStrategyDraft(empty), false);

  const draft: StrategyCopilotDraft = {
    name: 'Gold London Flow',
    instrument: 'XAUUSD',
    sessions: ['London', 'New York'],
    timeframes: ['M5'],
    rules: [
      { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'Sweep' },
      { key: 'choch', label: 'CHoCH', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'CHoCH' },
    ],
    logicTree: { logic: 'ALL', children: ['liquidity-sweep', 'choch'] },
    riskPercent: 0.5,
    minimumRR: 3,
    notes: ['Initial draft generated'],
  };

  assert.equal(hasGeneratedStrategyDraft(draft), true);
  assert.equal(canReviewStrategyDraft(draft), true);

  const refined = mergeStrategyCopilotDraft(draft, {
    ...draft,
    sessions: ['London'],
    notes: ['Refined for London only'],
  });

  assert.deepEqual(refined.sessions, ['London']);
  assert.equal(hasGeneratedStrategyDraft(refined), true);
  assert.equal(canReviewStrategyDraft(refined), true);
});

test('an empty Copilot draft does not replace approved risk or RR with zero', () => {
  const approved = normalizeStrategyCopilotReply({
    message: 'Drafted.', intent: 'CREATE', changes: [], unresolvedQuestions: [],
    strategyDraft: { name: 'London setup', instrument: 'XAUUSD', sessions: ['London', 'New York'], timeframes: ['M5'], rules: [], logicTree: { logic: 'ALL', children: [] }, riskPercent: 0.5, minimumRR: 2, notes: [] },
  }, emptyStrategyCopilotDraft());
  assert.equal(approved.strategyDraft.riskPercent, 0.5);
  assert.equal(approved.strategyDraft.minimumRR, 2);
});

test('strategy creation selector exposes the required four modes in the exact order and never auto-opens a mode', () => {
  const modes = getStrategyCreationModes();
  assert.deepEqual(modes, ['visual', 'copilot', 'methodology', 'blank']);
  assert.deepEqual(modes.map((mode) => STRATEGY_CREATION_MODE_LABELS[mode]), [
    'Build visually',
    'Describe your strategy — Beta',
    'Start from a methodology',
    'Start blank',
  ]);
  assert.equal(canReachFinalReviewDirectlyFromSelector(null), false);
  assert.equal(canReachFinalReviewDirectlyFromSelector('visual'), false);
  assert.equal(canReachFinalReviewDirectlyFromSelector('copilot'), false);
  assert.equal(canReachFinalReviewDirectlyFromSelector('methodology'), false);
  assert.equal(canReachFinalReviewDirectlyFromSelector('blank'), false);
});

test('ui path preserves XAUUSD and keeps the copilot draft in review until explicit approval', () => {
  const currentDraft: StrategyCopilotDraft = {
    name: 'Gold London Flow',
    instrument: 'XAUUSD',
    sessions: ['London', 'New York'],
    timeframes: ['M5'],
    rules: [
      { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'Sweep' },
      { key: 'choch', label: 'CHoCH', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'CHoCH' },
      { key: 'order-block', label: 'Order Block', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'OB' },
      { key: 'support-zone', label: 'Support Zone', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'Support/Resistance' },
    ],
    logicTree: { logic: 'ALL', children: ['liquidity-sweep', 'choch', 'support-zone', 'order-block'] },
    riskPercent: 1,
    minimumRR: 2,
    notes: ['Initial AI draft'],
  };

  const firstTurn = normalizeStrategyCopilotReply({
    message: 'Got it. I drafted a gold London/NY strategy.',
    intent: 'UPDATE',
    strategyDraft: currentDraft,
    changes: ['Session set to London + New York', 'Risk set to 1%', 'Minimum RR set to 2:1'],
    unresolvedQuestions: [],
  }, currentDraft);

  const secondTurn = normalizeStrategyCopilotReply({
    message: 'Actually, only London. CHoCH must be M5, and confirmation can be either Order Block or Support/Resistance.',
    intent: 'UPDATE',
    strategyDraft: {
      name: 'Gold London Flow',
      instrument: 'XAUUSD',
      sessions: ['London'],
      timeframes: ['M5'],
      rules: [
        { key: 'liquidity-sweep', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL' },
        { key: 'choch', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL' },
        { key: 'order-block', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY' },
        { key: 'support-zone', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY' },
      ],
      logicTree: { logic: 'ALL', children: ['liquidity-sweep', 'choch', 'order-block', 'support-zone'] },
      riskPercent: 1,
      minimumRR: 2,
      notes: ['Refined to London only'],
    },
    changes: ['Session changed to London', 'CHoCH locked to M5', 'Confirmation logic narrowed to ANY(Order Block, Support/Resistance)'],
    unresolvedQuestions: [],
  }, firstTurn.strategyDraft);

  assert.equal(firstTurn.strategyDraft.instrument, 'XAUUSD');
  assert.equal(secondTurn.strategyDraft.instrument, 'XAUUSD');
  assert.deepEqual(secondTurn.strategyDraft.sessions, ['London']);
  assert.ok(secondTurn.strategyDraft.rules.some((rule) => rule.key === 'liquidity-sweep' && rule.requirement === 'REQUIRED'));
  assert.ok(secondTurn.strategyDraft.rules.some((rule) => rule.key === 'choch' && rule.timeframe === 'M5'));
  assert.ok(secondTurn.strategyDraft.rules.some((rule) => rule.key === 'order-block' && rule.group === 'ANY'));
  assert.ok(secondTurn.strategyDraft.rules.some((rule) => rule.key === 'support-zone' && rule.requirement === 'OPTIONAL'));
  assert.equal(secondTurn.strategyDraft.logicTree.logic, 'ALL');
  assert.ok(secondTurn.strategyDraft.logicTree.children.includes('order-block'));
  assert.equal(secondTurn.strategyDraft.riskPercent, 1);
  assert.equal(secondTurn.strategyDraft.minimumRR, 2);
  assert.ok(secondTurn.changes.some((change) => change.includes('London')));
});

test('exact EURUSD London-session prompt preserves the real rule set, timeframes, and risk policy through extraction', () => {
  const exactPrompt = `I day trade EURUSD during the London session.

Use H4 as the macro timeframe, H1 for trend, M30 for confirmation, M15 for entry, and M1 for the trigger.

Required rules:
- H1 trend must be aligned with the trade direction.
- A break of structure must be confirmed on M30.
- Entry is allowed only after a confirmed retest on M15.

Optional confluence:
- A fair value gap near the retest area.

Maximum risk per trade is 0.5%.
Minimum risk-to-reward ratio is 1:2.
Do not trade during high-impact EUR or USD news.`;

  const next = extractStructuredDraftFromText(exactPrompt, emptyStrategyCopilotDraft());

  assert.equal(next.instrument, 'EURUSD');
  assert.deepEqual(next.sessions, ['London']);
  assert.ok(next.rules.some((rule) => rule.key === 'trend-alignment' && rule.requirement === 'REQUIRED' && rule.timeframe === 'H1'));
  assert.ok(next.rules.some((rule) => rule.key === 'bos' && rule.requirement === 'REQUIRED' && rule.timeframe === 'M30'));
  assert.ok(next.rules.some((rule) => rule.key === 'retest' && rule.requirement === 'REQUIRED' && rule.timeframe === 'M15'));
  assert.ok(next.rules.some((rule) => rule.key === 'fair-value-gap' && rule.requirement === 'OPTIONAL' && rule.group === 'ANY'));
  assert.deepEqual(next.timeframes.slice().sort(), ['H1', 'H4', 'M1', 'M15', 'M30'].sort());
  assert.equal(next.riskPercent, 0.5);
  assert.equal(next.minimumRR, 2);
});

test('exact EURUSD 3/1 semantics remain intact through extraction, normalization, merge, persistence, resave, and activation checks', () => {
  const exactPrompt = `I day trade EURUSD during the London session.

Use H4 as the macro timeframe, H1 for trend, M30 for confirmation, M15 for entry, and M1 for the trigger.

Required rules:
- H1 trend must be aligned with the trade direction.
- A break of structure must be confirmed on M30.
- Entry is allowed only after a confirmed retest on M15.

Optional confluence:
- A fair value gap near the retest area.

Maximum risk per trade is 0.5%.
Minimum risk-to-reward ratio is 1:2.
Do not trade during high-impact EUR or USD news.`;

  const extracted = extractStructuredDraftFromText(exactPrompt, emptyStrategyCopilotDraft());
  assert.equal(extracted.rules.filter((rule) => rule.requirement === 'REQUIRED').length, 3);
  assert.equal(extracted.rules.filter((rule) => rule.requirement === 'OPTIONAL').length, 1);

  const normalized = normalizeStrategyCopilotReply({
    message: 'Drafted the exact EURUSD rule set.',
    intent: 'UPDATE',
    strategyDraft: extracted,
    changes: [],
    unresolvedQuestions: [],
  }, emptyStrategyCopilotDraft());
  assert.equal(normalized.strategyDraft.rules.filter((rule) => rule.requirement === 'REQUIRED').length, 3);
  assert.equal(normalized.strategyDraft.rules.filter((rule) => rule.requirement === 'OPTIONAL').length, 1);

  const merged = mergeStrategyCopilotDraft(emptyStrategyCopilotDraft(), normalized.strategyDraft);
  assert.equal(merged.rules.filter((rule) => rule.requirement === 'REQUIRED').length, 3);
  assert.equal(merged.rules.filter((rule) => rule.requirement === 'OPTIONAL').length, 1);

  const state = {
    name: 'EURUSD London Flow',
    instruments: ['EURUSD'],
    sessions: ['LONDON'],
    methodologyIds: ['trend-following', 'supply-demand'],
    ruleSelections: merged.rules,
    contextTimeframe: 'H4',
    executionTimeframe: 'M15',
    riskPercent: 0.5,
    minimumRR: 2,
  };

  const baseProfile = {
    ...DEFAULT_STRATEGY_PROFILE,
    id: 'eurusd-london-flow',
    name: 'EURUSD London Flow',
    instruments: ['EURUSD'],
    allowedSessions: ['LONDON'],
    macroTimeframe: 'H4',
    trendTimeframe: 'H1',
    confirmationTimeframe: 'M30',
    entryTimeframe: 'M15',
    triggerTimeframe: 'M1',
    maximumRiskPercent: 0.5,
    minimumRR: 2,
    requiredEvidence: ['h4TrendAligned', 'h1TrendAligned', 'structurePattern'] as const,
    evidenceWeights: {
      h4TrendAligned: 10,
      h1TrendAligned: 10,
      structurePattern: 10,
      liquiditySweep: 10,
      chochConfirmed: 10,
      bosConfirmed: 10,
      orderBlock: 7,
      fairValueGap: 7,
      retestConfirmed: 6,
    },
  } satisfies typeof DEFAULT_STRATEGY_PROFILE;

  const persisted = v2StateToPersistedStrategy(baseProfile, state as never);
  assert.equal(persisted.rules.filter((rule) => rule.mandatory).length, 3);
  assert.equal(persisted.rules.filter((rule) => !rule.mandatory).length, 1);

  const reloaded = persistedStrategyToV2State(persisted.profile, persisted.rules, persisted.sessions);
  assert.equal(reloaded.ruleSelections.filter((rule) => rule.requirement === 'REQUIRED').length, 3);
  assert.equal(reloaded.ruleSelections.filter((rule) => rule.requirement === 'OPTIONAL').length, 1);

  const resaved = v2StateToPersistedStrategy(persisted.profile, reloaded);
  assert.equal(resaved.rules.filter((rule) => rule.mandatory).length, 3);
  assert.equal(resaved.rules.filter((rule) => !rule.mandatory).length, 1);

  const evidenceWeights = {
    h4TrendAligned: 10,
    h1TrendAligned: 10,
    structurePattern: 10,
    liquiditySweep: 10,
    chochConfirmed: 10,
    bosConfirmed: 10,
    orderBlock: 7,
    fairValueGap: 7,
    retestConfirmed: 6,
  } satisfies Record<EvidenceKey, number>;

  const valid = {
    rules: resaved.rules,
    requiredEvidence: deriveRequiredEvidence(resaved.rules, evidenceWeights),
    evidenceWeights,
  };
  assert.doesNotThrow(() => assertUsableRequiredRules(valid));

  const optionalOnly = {
    rules: resaved.rules.filter((rule) => !rule.mandatory),
    requiredEvidence: [],
    evidenceWeights,
  };
  assert.throws(() => assertUsableRequiredRules(optionalOnly), /Strategy setup required/i);
});

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
  assert.equal(tree.children[2].type, 'GROUP');
  if (tree.children[2].type === 'GROUP') {
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
  assert.ok(persisted.children.some((child) => child.type === 'GROUP' && child.logic === 'ANY'));
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

  const allGroupCount = tree.children.filter((child) => child.type === 'CONDITION').length;
  const anyGroup = tree.children.find((child) => child.type === 'GROUP' && child.logic === 'ANY');

  assert.equal(allGroupCount, 2);
  assert.ok(anyGroup && anyGroup.type === 'GROUP');
  if (anyGroup && anyGroup.type === 'GROUP') {
    assert.equal(anyGroup.children.length, 2);
    assert.ok(anyGroup.children.every((child) => child.type === 'CONDITION'));
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

test('methodology defaults do not resurrect removed SMC rules after rerender or navigation', () => {
  const initial = createDefaultRuleSelection();
  const afterDelete = initial.filter((rule) => !['choch', 'bos', 'order-block', 'fair-value-gap'].includes(rule.key));

  const canonical = reconcileRuleSelectionsWithMethodologies({
    methodologyIds: ['smc'],
    ruleSelections: afterDelete,
  });

  assert.deepEqual(canonical.map((rule) => rule.key), ['liquidity-sweep']);
  assert.ok(!canonical.some((rule) => rule.key === 'choch'));
  assert.ok(!canonical.some((rule) => rule.key === 'bos'));
  assert.ok(!canonical.some((rule) => rule.key === 'order-block'));
  assert.ok(!canonical.some((rule) => rule.key === 'fair-value-gap'));
  assert.ok(canonical.some((rule) => rule.key === 'liquidity-sweep'));

  const afterNavigation = reconcileRuleSelectionsWithMethodologies({
    methodologyIds: ['smc'],
    ruleSelections: canonical,
  });

  assert.deepEqual(afterNavigation.map((rule) => rule.key), ['liquidity-sweep']);
  const summary = buildHealthSummary({ selectedRules: afterNavigation, conflicts: detectStrategyConflicts({ selectedRules: afterNavigation, riskPercent: 0.5, minimumRR: 3 }) });
  assert.equal(summary.totalRules, 1);
  assert.equal(summary.automatic, 1);
  assert.equal(summary.required, 1);
  assert.equal(summary.optional, 0);
  assert.equal(summary.unresolvedConflicts, 0);
});

test('copilot merge preserves previous draft and updates a single rule within the same session', () => {
  const base: StrategyCopilotDraft = {
    sessions: ['London', 'New York'],
    timeframes: ['M5'],
    rules: [
      { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'sweep' },
      { key: 'choch', label: 'CHoCH', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'choch' },
      { key: 'order-block', label: 'Order Block', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'ob' },
      { key: 'fair-value-gap', label: 'Fair Value Gap', capability: 'AUTOMATIC', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'fvg' },
    ],
    logicTree: { logic: 'ALL', children: ['liquidity-sweep', 'choch'] },
    riskPercent: 0.5,
    minimumRR: 3,
    notes: ['Initial draft'],
  };

  const nextDraft: StrategyCopilotDraft = {
    sessions: ['London'],
    timeframes: ['M5'],
    rules: [
      { key: 'choch', label: 'CHoCH', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'choch' },
      { key: 'fair-value-gap', label: 'Fair Value Gap', capability: 'AUTOMATIC', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'fvg' },
    ],
    logicTree: { logic: 'ALL', children: ['choch'] },
    riskPercent: 0.5,
    minimumRR: 3,
    notes: ['Updated to London only'],
  };

  const merged = mergeStrategyCopilotDraft(base, nextDraft);

  assert.ok(merged.rules.some((rule) => rule.key === 'liquidity-sweep'));
  assert.ok(merged.rules.some((rule) => rule.key === 'choch'));
  assert.ok(merged.rules.some((rule) => rule.key === 'fair-value-gap'));
  assert.deepEqual(merged.sessions, ['London']);
  assert.equal(merged.minimumRR, 3);
});

test('copilot normalization rejects hallucinated rule IDs and keeps descriptive rules optional', () => {
  const previous: StrategyCopilotDraft = {
    sessions: ['London'],
    timeframes: ['M5'],
    rules: [],
    logicTree: { logic: 'ALL', children: [] },
    notes: [],
  };

  assert.throws(() => normalizeStrategyCopilotReply({
    message: 'bad',
    intent: 'CREATE',
    strategyDraft: {
      sessions: ['London'],
      timeframes: ['M5'],
      rules: [{ key: 'ghost-rule', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL' }],
      riskPercent: 0.5,
      minimumRR: 3,
      notes: [],
    },
    changes: [],
    unresolvedQuestions: [],
  }, previous), /unknown rule/i);

  const reply = normalizeStrategyCopilotReply({
    message: 'Draft created',
    intent: 'CREATE',
    strategyDraft: {
      name: 'London Flow',
      instrument: 'XAUUSD',
      sessions: ['London'],
      timeframes: ['M5'],
      rules: [{ key: 'custom-rule', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ALL' }],
      riskPercent: 0.5,
      minimumRR: 3,
      notes: ['Custom descriptive note'],
    },
    changes: ['Added custom rule'],
    unresolvedQuestions: [],
  }, previous);

  assert.equal(reply.strategyDraft.rules[0].capability, 'DESCRIPTIVE');
  assert.equal(reply.strategyDraft.rules[0].requirement, 'OPTIONAL');
});

test('valid AI draft accepts the canonical London gold example while preserving the V2 catalog constraints', () => {
  const previous: StrategyCopilotDraft = {
    sessions: ['London', 'New York'],
    timeframes: ['M5'],
    rules: [
      { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'Sweep' },
      { key: 'choch', label: 'CHoCH', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'CHoCH' },
    ],
    logicTree: { logic: 'ALL', children: ['liquidity-sweep', 'choch'] },
    riskPercent: 0.5,
    minimumRR: 3,
    notes: ['Original draft'],
  };

  const reply = normalizeStrategyCopilotReply({
    message: 'I trade gold during London and New York. I want liquidity sweep and CHoCH, but I do not need both Order Block and FVG.',
    intent: 'UPDATE',
    strategyDraft: {
      name: 'Gold London Flow',
      instrument: 'XAUUSD',
      sessions: ['London', 'New York'],
      timeframes: ['M5'],
      rules: [
        { key: 'liquidity-sweep', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL' },
        { key: 'choch', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL' },
        { key: 'order-block', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY' },
        { key: 'fair-value-gap', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY' },
      ],
      riskPercent: 0.5,
      minimumRR: 3,
      notes: ['Updated gold flow'],
    },
    changes: ['Matched the canonical gold flow'],
    unresolvedQuestions: [],
  }, previous);

  assert.equal(reply.strategyDraft.instrument, 'XAUUSD');
  assert.deepEqual(reply.strategyDraft.sessions, ['London', 'New York']);
  assert.ok(reply.strategyDraft.rules.some((rule) => rule.key === 'liquidity-sweep' && rule.group === 'ALL'));
  assert.ok(reply.strategyDraft.rules.some((rule) => rule.key === 'choch' && rule.group === 'ALL'));
  assert.ok(reply.strategyDraft.rules.some((rule) => rule.key === 'order-block' && rule.group === 'ANY'));
  assert.ok(reply.strategyDraft.rules.some((rule) => rule.key === 'fair-value-gap' && rule.group === 'ANY'));
  assert.equal(reply.strategyDraft.riskPercent, 0.5);
});

test('unsupported methodology, detector, and instrument values fail closed', () => {
  assert.throws(() => normalizeStrategyCopilotReply({
    message: 'unsupported',
    intent: 'CREATE',
    strategyDraft: {
      sessions: ['London'],
      timeframes: ['M5'],
      methodology: 'quantum-signal',
      detectorIds: ['bogus-detector'],
      instrument: 'BTCUSD',
      rules: [{ key: 'liquidity-sweep', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL' }],
      riskPercent: 0.5,
      minimumRR: 3,
      notes: ['bad'],
    },
    changes: [],
    unresolvedQuestions: [],
  }), /Unsupported methodology|Unsupported detector|Unsupported instrument/i);

  assert.throws(() => normalizeStrategyCopilotReply({
    message: 'unsupported',
    intent: 'CREATE',
    strategyDraft: {
      sessions: ['London'],
      timeframes: ['M5'],
      methodologies: ['unsupported-method'],
      rules: [{ key: 'liquidity-sweep', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL' }],
      riskPercent: 0.5,
      minimumRR: 3,
      notes: ['bad'],
    },
    changes: [],
    unresolvedQuestions: [],
  }), /Unsupported methodology/i);
});

test('AI draft cannot override risk settings and preserves prior valid values across turns', () => {
  const previous: StrategyCopilotDraft = {
    sessions: ['London'],
    timeframes: ['M5'],
    rules: [{ key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'Sweep' }],
    logicTree: { logic: 'ALL', children: ['liquidity-sweep'] },
    riskPercent: 0.75,
    minimumRR: 3,
    notes: ['Safe prior'],
  };

  const reply = normalizeStrategyCopilotReply({
    message: 'Actually just London and make the risk 5%.',
    intent: 'UPDATE',
    strategyDraft: {
      sessions: ['London'],
      timeframes: ['M5'],
      rules: [{ key: 'liquidity-sweep', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL' }],
      riskPercent: 5,
      minimumRR: 10,
      notes: ['tried to override risk'],
    },
    changes: ['Risk controls attempted'],
    unresolvedQuestions: [],
  }, previous);

  assert.equal(reply.strategyDraft.riskPercent, 0.75);
  assert.equal(reply.strategyDraft.minimumRR, 3);
  assert.deepEqual(reply.strategyDraft.sessions, ['London']);
});

test('extractStructuredDraftFromText preserves prior draft while adjusting sessions and optional semantics for the next turn', () => {
  const previous: StrategyCopilotDraft = {
    sessions: ['London', 'New York'],
    timeframes: ['M5'],
    rules: [
      { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'Sweep' },
      { key: 'choch', label: 'CHoCH', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'CHoCH' },
      { key: 'order-block', label: 'Order Block', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'OB' },
      { key: 'fair-value-gap', label: 'Fair Value Gap', capability: 'AUTOMATIC', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'FVG' },
    ],
    logicTree: { logic: 'ALL', children: ['liquidity-sweep', 'choch', 'order-block', 'fair-value-gap'] },
    riskPercent: 0.5,
    minimumRR: 3,
    notes: ['initial'],
  };

  const next = normalizeStrategyCopilotReply({
    message: 'Actually, only London, CHoCH is M5, and FVG is optional.',
    intent: 'UPDATE',
    strategyDraft: {
      sessions: ['London'],
      timeframes: ['M5'],
      rules: [
        { key: 'liquidity-sweep', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL' },
        { key: 'choch', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL' },
        { key: 'fair-value-gap', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY' },
      ],
      riskPercent: 0.5,
      minimumRR: 3,
      notes: ['follow up'],
    },
    changes: ['Updated to London only'],
    unresolvedQuestions: [],
  }, previous);

  assert.deepEqual(next.strategyDraft.sessions, ['London']);
  assert.ok(next.strategyDraft.rules.some((rule) => rule.key === 'choch' && rule.timeframe === 'M5'));
  assert.ok(next.strategyDraft.rules.some((rule) => rule.key === 'fair-value-gap' && rule.requirement === 'OPTIONAL'));
  assert.equal(next.strategyDraft.riskPercent, 0.5);
});

test('strategy health and conflict detection still run on the canonical V2 draft', () => {
  const rules = [
    { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL' },
    { key: 'choch', label: 'CHoCH', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL' },
    { key: 'order-block', label: 'Order Block', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY' },
    { key: 'fair-value-gap', label: 'Fair Value Gap', capability: 'AUTOMATIC', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY' },
  ] satisfies RuleSelection[];

  const conflicts = detectStrategyConflicts({ selectedRules: rules, riskPercent: 0.5, minimumRR: 3 });
  const summary = buildHealthSummary({ selectedRules: rules, conflicts });

  assert.equal(summary.totalRules, 4);
  assert.equal(summary.warningText, 'No unresolved conflicts');
  assert.deepEqual(conflicts, []);
});

test('malformed AI payloads fail closed without mutating the prior draft', () => {
  const previous: StrategyCopilotDraft = {
    sessions: ['London'],
    timeframes: ['M5'],
    rules: [{ key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'Sweep' }],
    logicTree: { logic: 'ALL', children: ['liquidity-sweep'] },
    riskPercent: 0.5,
    minimumRR: 3,
    notes: ['safe'],
  };

  assert.throws(() => normalizeStrategyCopilotReply({
    message: 'bad',
    intent: 'CREATE',
    strategyDraft: null,
    changes: [],
    unresolvedQuestions: [],
  }, previous), /no strategy draft/i);

  assert.throws(() => normalizeStrategyCopilotReply({
    message: 'bad',
    intent: 'CREATE',
    strategyDraft: {
      sessions: ['London'],
      timeframes: ['M5'],
      rules: [{ key: 'ghost-rule', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL' }],
      notes: [],
    },
    changes: [],
    unresolvedQuestions: [],
  }, previous), /unknown rule/i);
});

test('legacy strategies remain unaffected by the AI draft normalization layer', () => {
  const previous: StrategyCopilotDraft = {
    sessions: ['London'],
    timeframes: ['M5'],
    rules: [{ key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL', description: 'legacy' }],
    logicTree: { logic: 'ALL', children: ['liquidity-sweep'] },
    riskPercent: 0.5,
    minimumRR: 3,
    notes: ['legacy strategy'],
  };

  const reply = normalizeStrategyCopilotReply({
    message: 'Legacy strategy should be preserved',
    intent: 'CLARIFY',
    strategyDraft: {
      sessions: ['London'],
      timeframes: ['M5'],
      rules: [{ key: 'liquidity-sweep', requirement: 'REQUIRED', timeframe: 'M5', group: 'ALL' }],
      notes: ['legacy means no drift'],
    },
    changes: ['No-op'],
    unresolvedQuestions: [],
  }, previous);

  assert.equal(reply.strategyDraft.rules[0].key, 'liquidity-sweep');
  assert.equal(reply.strategyDraft.riskPercent, 0.5);
  assert.equal(reply.strategyDraft.minimumRR, 3);
});
