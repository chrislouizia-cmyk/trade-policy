import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptCanonicalCreationDraftToV2Persistence,
  assessCanonicalCreationDraft,
  canonicalCreationDraftFromPersistedStrategy,
  confirmCanonicalCreationDraft,
  createCanonicalCreationDraft,
  updateCanonicalCreationDraft,
  type CanonicalCreationField,
  type ValueProvenance,
} from '../lib/strategy-creation-contract.ts';
import type { StrategyBuilderV2State } from '../lib/strategy-builder-v2-persistence.ts';
import { DEFAULT_STRATEGY_PROFILE, type StrategyProfile, type StrategyRule, type StrategySession } from '../types/trade.ts';

const completeState = (): StrategyBuilderV2State => ({
  name: 'EURUSD London Structure',
  instruments: ['EURUSD'],
  sessions: ['LONDON'],
  contextTimeframe: 'H4',
  executionTimeframe: 'M15',
  methodologyIds: ['trend-following', 'supply-demand'],
  ruleSelections: [
    { key: 'trend-alignment', label: 'Trend Alignment', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'H1', group: 'ALL', description: 'Higher-timeframe direction agrees.' },
    { key: 'retest', label: 'Retest', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL', description: 'Price retests structure.' },
    { key: 'order-block', label: 'Order Block', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M15', group: 'ANY', description: 'Optional execution context.' },
  ],
  ruleTree: {
    type: 'GROUP', logic: 'ALL', children: [
      { type: 'CONDITION', ruleKey: 'trend-alignment', requirement: 'REQUIRED', timeframe: 'H1' },
      { type: 'CONDITION', ruleKey: 'retest', requirement: 'REQUIRED', timeframe: 'M15' },
      { type: 'GROUP', logic: 'ANY', children: [
        { type: 'CONDITION', ruleKey: 'order-block', requirement: 'OPTIONAL', timeframe: 'M15' },
      ] },
    ],
  },
  riskPercent: 0.5,
  minimumRR: 2,
  stopLogic: 'Below the confirmed swing.',
  targetLogic: 'At the next liquidity objective.',
  direction: 'BOTH',
});

const provenanceFor = (state: StrategyBuilderV2State, source: ValueProvenance = 'EXPLICIT') => {
  const fields: CanonicalCreationField[] = [
    'name', 'instruments', 'sessions', 'contextTimeframe', 'executionTimeframe',
    'methodologyIds', 'ruleSelections', 'ruleTree', 'riskPercent', 'minimumRR',
    'stopLogic', 'targetLogic', 'direction',
  ];
  return Object.fromEntries(fields.filter((field) => state[field] !== undefined).map((field) => [field, source]));
};

const baseProfile = (): StrategyProfile => ({
  ...structuredClone(DEFAULT_STRATEGY_PROFILE),
  id: undefined,
  name: '',
  instruments: [],
  allowedSessions: [],
  personalRules: [],
});

test('creation starts in CAPTURING with a truly blank draft and no silent XAUUSD default', () => {
  const draft = createCanonicalCreationDraft({ intent: 'CREATE' });
  const assessment = assessCanonicalCreationDraft(draft);

  assert.equal(draft.state, 'CAPTURING');
  assert.equal(assessment.state, 'CAPTURING');
  assert.equal(draft.values.instruments.some((instrument) => instrument === 'XAUUSD'), false);
  assert.deepEqual(draft.values.instruments, []);
  assert.deepEqual(draft.values.sessions, []);
  assert.deepEqual(draft.values.ruleSelections, []);
  assert.deepEqual(draft.provenance, {});
});

test('partial or ambiguous creation becomes NEEDS_CLARIFICATION with stable necessary questions', () => {
  const draft = createCanonicalCreationDraft({
    intent: 'CREATE',
    values: { name: 'London idea', instruments: ['EURUSD'] },
    provenance: { name: 'EXPLICIT', instruments: 'INFERRED' },
  });
  const assessment = assessCanonicalCreationDraft(draft);

  assert.equal(assessment.state, 'NEEDS_CLARIFICATION');
  assert.ok(assessment.missingFields.includes('sessions'));
  assert.ok(assessment.missingFields.includes('contextTimeframe'));
  assert.ok(assessment.missingFields.includes('executionTimeframe'));
  assert.ok(assessment.missingFields.includes('ruleSelections'));
  assert.ok(assessment.missingFields.includes('riskPercent'));
  assert.ok(assessment.missingFields.includes('minimumRR'));
  assert.ok(assessment.clarifications.some((item) => item.code === 'MISSING_SESSIONS'));
  assert.ok(assessment.clarifications.some((item) => item.code === 'MISSING_RULES'));
});

test('complete explicit input is READY_FOR_REVIEW and only explicit review confirmation makes it CONFIRMED', () => {
  const values = completeState();
  const draft = createCanonicalCreationDraft({ intent: 'CREATE', values, provenance: provenanceFor(values) });

  assert.equal(draft.state, 'READY_FOR_REVIEW');
  assert.equal(draft.reviewConfirmed, false);
  assert.equal(assessCanonicalCreationDraft(draft).canPersist, false);

  const confirmed = confirmCanonicalCreationDraft(draft);
  assert.equal(confirmed.state, 'CONFIRMED');
  assert.equal(confirmed.reviewConfirmed, true);
  assert.equal(assessCanonicalCreationDraft(confirmed).canPersist, true);
});

test('explicit and inferred provenance remain distinguishable and inferred sensitive values never auto-confirm', () => {
  const values = completeState();
  const draft = createCanonicalCreationDraft({
    intent: 'CREATE',
    values,
    provenance: {
      ...provenanceFor(values),
      instruments: 'INFERRED',
      sessions: 'INFERRED',
      riskPercent: 'DEFAULT_CONFIRMED',
    },
  });
  const assessment = assessCanonicalCreationDraft(draft);

  assert.equal(draft.provenance.name, 'EXPLICIT');
  assert.equal(draft.provenance.instruments, 'INFERRED');
  assert.equal(draft.provenance.riskPercent, 'DEFAULT_CONFIRMED');
  assert.equal(assessment.state, 'READY_FOR_REVIEW');
  assert.equal(assessment.canPersist, false);
  assert.ok(assessment.confirmationSensitiveFields.includes('instruments'));
  assert.ok(assessment.confirmationSensitiveFields.includes('riskPercent'));

  const partiallyConfirmed = confirmCanonicalCreationDraft(draft, ['instruments', 'sessions']);
  assert.equal(partiallyConfirmed.state, 'READY_FOR_REVIEW');
  assert.equal(assessCanonicalCreationDraft(partiallyConfirmed).canPersist, false);
});

test('a described methodology may infer structure but remains reviewable until the trader confirms it', () => {
  const values = completeState();
  const draft = createCanonicalCreationDraft({
    intent: 'CREATE',
    values,
    provenance: {
      ...provenanceFor(values, 'INFERRED'),
      name: 'EXPLICIT',
      riskPercent: 'EXPLICIT',
      minimumRR: 'EXPLICIT',
    },
  });

  assert.equal(draft.state, 'READY_FOR_REVIEW');
  assert.equal(draft.provenance.methodologyIds, 'INFERRED');
  assert.equal(draft.provenance.ruleSelections, 'INFERRED');
  assert.equal(assessCanonicalCreationDraft(draft).canPersist, false);

  const confirmed = confirmCanonicalCreationDraft(draft);
  const adapted = adaptCanonicalCreationDraftToV2Persistence(baseProfile(), confirmed);
  assert.equal(confirmed.state, 'CONFIRMED');
  assert.deepEqual(adapted.persisted.metadata.methodologyIds, values.methodologyIds);
  assert.deepEqual(adapted.persisted.metadata.ruleSelections, values.ruleSelections);
});

test('a populated value without provenance is rejected as a silent default', () => {
  const values = completeState();
  const provenance = provenanceFor(values);
  delete provenance.instruments;
  const draft = createCanonicalCreationDraft({ intent: 'CREATE', values, provenance });
  const assessment = assessCanonicalCreationDraft(draft);

  assert.equal(assessment.state, 'NEEDS_CLARIFICATION');
  assert.ok(assessment.issues.some((issue) => issue.code === 'UNATTRIBUTED_VALUE' && issue.field === 'instruments'));
  assert.ok(assessment.clarifications.some((item) => item.code === 'CONFIRM_VALUE_SOURCE' && item.field === 'instruments'));
});

test('new unknown rules fail closed while DESCRIPTIVE rules never become mandatory evidence', () => {
  const values = completeState();
  values.ruleSelections = [
    { key: 'unknown-secret-rule', label: 'Secret Rule', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL' },
  ];
  values.ruleTree = undefined;
  const unknown = createCanonicalCreationDraft({ intent: 'CREATE', values, provenance: provenanceFor(values) });
  const assessment = assessCanonicalCreationDraft(unknown);
  assert.equal(assessment.state, 'NEEDS_CLARIFICATION');
  assert.ok(assessment.issues.some((issue) => issue.code === 'UNKNOWN_RULE'));

  const descriptiveValues = completeState();
  descriptiveValues.ruleSelections.push({ key: 'premium-discount', label: 'Premium / Discount', capability: 'DESCRIPTIVE', requirement: 'REQUIRED', timeframe: 'M15', group: 'ANY' });
  descriptiveValues.ruleTree = undefined;
  const descriptive = confirmCanonicalCreationDraft(createCanonicalCreationDraft({ intent: 'CREATE', values: descriptiveValues, provenance: provenanceFor(descriptiveValues) }));
  const adapted = adaptCanonicalCreationDraftToV2Persistence(baseProfile(), descriptive);
  const rule = adapted.persisted.rules.find((item) => item.ruleKey === 'premium-discount');
  assert.equal(rule?.mandatory, false);
  assert.equal(adapted.requiredEvidence.includes('premium-discount' as never), false);
});

test('V2 adaptation preserves ALL/ANY, required/optional, evaluation modes, and strategy identity during edit', () => {
  const values = completeState();
  values.ruleSelections.push({ key: 'session-open', label: 'Session Open', capability: 'EXTERNAL', requirement: 'OPTIONAL', timeframe: 'M15', group: 'ANY' });
  values.ruleTree = {
    type: 'GROUP', logic: 'ALL', children: [
      { type: 'CONDITION', ruleKey: 'trend-alignment', requirement: 'REQUIRED', timeframe: 'H1' },
      { type: 'CONDITION', ruleKey: 'retest', requirement: 'REQUIRED', timeframe: 'M15' },
      { type: 'GROUP', logic: 'ANY', children: [
        { type: 'CONDITION', ruleKey: 'order-block', requirement: 'OPTIONAL', timeframe: 'M15' },
        { type: 'CONDITION', ruleKey: 'session-open', requirement: 'OPTIONAL', timeframe: 'M15' },
      ] },
    ],
  };
  const existing = { ...baseProfile(), id: 'strategy-exact-id', name: values.name };
  const draft = confirmCanonicalCreationDraft(createCanonicalCreationDraft({
    intent: 'EDIT', strategyId: existing.id, values, provenance: provenanceFor(values),
  }));
  const adapted = adaptCanonicalCreationDraftToV2Persistence(existing, draft);

  assert.equal(adapted.persisted.profile.id, 'strategy-exact-id');
  assert.deepEqual(adapted.persisted.metadata.ruleTree, values.ruleTree);
  assert.equal(adapted.persisted.rules.find((rule) => rule.ruleKey === 'trend-alignment')?.mandatory, true);
  assert.equal(adapted.persisted.rules.find((rule) => rule.ruleKey === 'order-block')?.mandatory, false);
  assert.equal(adapted.persisted.rules.find((rule) => rule.ruleKey === 'trend-alignment')?.evaluationMode, 'AUTOMATIC');
  assert.equal(adapted.persisted.rules.find((rule) => rule.ruleKey === 'order-block')?.evaluationMode, 'MANUAL');
  assert.equal(adapted.persisted.rules.find((rule) => rule.ruleKey === 'session-open')?.evaluationMode, 'EXTERNAL');
});

test('editing a value clears prior review confirmation without changing strategy identity', () => {
  const values = completeState();
  const confirmed = confirmCanonicalCreationDraft(createCanonicalCreationDraft({
    intent: 'EDIT', strategyId: 'strategy-one', values, provenance: provenanceFor(values),
  }));
  const updated = updateCanonicalCreationDraft(confirmed, { minimumRR: 3 }, { minimumRR: 'EXPLICIT' });

  assert.equal(updated.strategyId, 'strategy-one');
  assert.equal(updated.values.minimumRR, 3);
  assert.equal(updated.reviewConfirmed, false);
  assert.equal(updated.state, 'READY_FOR_REVIEW');
});

test('legacy strategy hydration remains valid without V2 metadata and round-trips without invented values', () => {
  const legacyProfile: StrategyProfile = {
    ...baseProfile(),
    id: 'legacy-id',
    name: 'Legacy London',
    instruments: ['GBPUSD'],
    allowedSessions: ['CUSTOM_LEGACY'],
    macroTimeframe: 'H4',
    entryTimeframe: 'M15',
    maximumRiskPercent: 0.75,
    minimumRR: 2.5,
    strategyMethodologies: [],
    personalRules: [{ key: 'legacy-note', enabled: true, value: 'preserve me' }],
  };
  const legacyRules: StrategyRule[] = [
    { ruleKey: 'retest', label: 'Retest', enabled: true, mandatory: true, weight: 10, minimumConfidence: 60, timeframeRole: 'ENTRY', evaluationMode: 'AUTOMATIC' },
    { ruleKey: 'legacy-private-rule', label: 'Legacy Private Rule', enabled: true, mandatory: false, weight: 6, minimumConfidence: 60, timeframeRole: 'ENTRY', evaluationMode: 'MANUAL' },
  ];
  const legacySessions: StrategySession[] = [
    { sessionCode: 'CUSTOM_LEGACY', name: 'Custom Legacy', timezone: 'UTC', startTime: '07:00', endTime: '10:00', days: [1, 2, 3, 4, 5], allowOpenOutside: false, allowHoldOutside: true, isCustom: true },
  ];

  const draft = canonicalCreationDraftFromPersistedStrategy(legacyProfile, legacyRules, legacySessions);
  assert.equal(draft.intent, 'EDIT');
  assert.equal(draft.strategyId, 'legacy-id');
  assert.equal(draft.provenance.ruleSelections, 'LEGACY');
  assert.equal(draft.values.instruments.includes('XAUUSD'), false);
  assert.equal(assessCanonicalCreationDraft(draft).issues.some((issue) => issue.code === 'UNKNOWN_RULE'), false);

  const adapted = adaptCanonicalCreationDraftToV2Persistence(legacyProfile, confirmCanonicalCreationDraft(draft));
  assert.equal(adapted.persisted.profile.id, 'legacy-id');
  assert.deepEqual(adapted.persisted.profile.instruments, ['GBPUSD']);
  assert.deepEqual(adapted.persisted.profile.allowedSessions, ['CUSTOM_LEGACY']);
  assert.equal(adapted.persisted.rules[0].ruleKey, 'retest');
  assert.equal(adapted.persisted.rules[0].mandatory, true);
  assert.equal(adapted.persisted.rules[1].ruleKey, 'legacy-private-rule');
  assert.equal(adapted.persisted.rules[1].mandatory, false);
  assert.deepEqual(adapted.persisted.rules, legacyRules);
  assert.equal(adapted.persisted.profile.personalRules?.some((rule) => rule.key === 'legacy-note'), true);
});

test('adaptation refuses unconfirmed drafts and edit/base identity mismatches', () => {
  const values = completeState();
  const ready = createCanonicalCreationDraft({ intent: 'EDIT', strategyId: 'expected', values, provenance: provenanceFor(values) });
  assert.throws(() => adaptCanonicalCreationDraftToV2Persistence({ ...baseProfile(), id: 'expected' }, ready), /confirmed/i);

  const confirmed = confirmCanonicalCreationDraft(ready);
  assert.throws(() => adaptCanonicalCreationDraftToV2Persistence({ ...baseProfile(), id: 'different' }, confirmed), /identity/i);
});
