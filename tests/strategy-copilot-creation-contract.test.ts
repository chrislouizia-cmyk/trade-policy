import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assessCanonicalCreationDraft,
  confirmCanonicalCreationDraft,
  createCanonicalCreationDraft,
} from '../lib/strategy-creation-contract.ts';
import {
  mapCopilotReplyToCanonicalCreation,
} from '../lib/strategy-copilot-creation.ts';
import { mergeStrategyCopilotDraft, normalizeStrategyCopilotReply, type StrategyCopilotReply } from '../lib/strategy-copilot.ts';

const rule = (key = 'liquidity-sweep', overrides: Record<string, unknown> = {}) => ({
  key,
  label: key === 'liquidity-sweep' ? 'Liquidity Sweep' : 'Fair Value Gap',
  capability: 'AUTOMATIC' as const,
  requirement: 'REQUIRED' as const,
  timeframe: 'M15',
  group: 'ALL' as const,
  ...overrides,
});

function reply(overrides: Partial<StrategyCopilotReply> = {}): StrategyCopilotReply {
  return {
    message: 'Drafted for review.',
    intent: 'CREATE',
    strategyDraft: {
      name: 'London Sweep',
      instrument: 'EURUSD',
      sessions: ['London'],
      timeframes: ['H4', 'M15'],
      rules: [rule()],
      logicTree: { logic: 'ALL', children: ['liquidity-sweep'] },
      riskPercent: 0.5,
      minimumRR: 2,
      notes: [],
    },
    changes: [],
    unresolvedQuestions: [],
    ...overrides,
  };
}

const completePrompt = 'Call it London Sweep. I trade EURUSD only in London. Use H4 as context and M15 for entry. Require a liquidity sweep. Maximum risk is 0.5% and minimum RR is 1:2.';

test('direct trader statements map to EXPLICIT canonical provenance', () => {
  const mapped = mapCopilotReplyToCanonicalCreation({ userMessage: completePrompt, reply: reply() });

  assert.equal(mapped.draft.values.name, 'London Sweep');
  assert.deepEqual(mapped.draft.values.instruments, ['EURUSD']);
  assert.deepEqual(mapped.draft.values.sessions, ['LONDON']);
  assert.equal(mapped.draft.values.contextTimeframe, 'H4');
  assert.equal(mapped.draft.values.executionTimeframe, 'M15');
  for (const field of ['name', 'instruments', 'sessions', 'contextTimeframe', 'executionTimeframe', 'ruleSelections', 'riskPercent', 'minimumRR'] as const) {
    assert.equal(mapped.draft.provenance[field], 'EXPLICIT', field);
  }
  assert.equal(mapped.assessment.state, 'READY_FOR_REVIEW');
  assert.equal(mapped.assessment.canPersist, false);
});

test('Copilot deductions remain INFERRED and sensitive values require trader confirmation', () => {
  const mapped = mapCopilotReplyToCanonicalCreation({
    userMessage: 'Build a conservative London strategy for me.',
    reply: reply(),
  });

  assert.equal(mapped.draft.provenance.instruments, 'INFERRED');
  assert.equal(mapped.draft.provenance.riskPercent, 'INFERRED');
  assert.equal(mapped.draft.confirmedSensitiveFields.length, 0);
  assert.equal(mapped.assessment.canPersist, false);
  assert.equal(mapped.assessment.state, 'READY_FOR_REVIEW');
});

test('a silent or unattributed XAUUSD fallback is never introduced by the canonical mapping', () => {
  const empty = reply({
    strategyDraft: { sessions: [], timeframes: [], rules: [], logicTree: { logic: 'ALL', children: [] }, notes: [] },
  });
  const mapped = mapCopilotReplyToCanonicalCreation({ userMessage: 'Help me build a strategy.', reply: empty });

  assert.deepEqual(mapped.draft.values.instruments, []);
  assert.equal(mapped.draft.provenance.instruments, undefined);
  assert.ok(mapped.assessment.missingFields.includes('instruments'));
  assert.ok(mapped.assessment.clarifications.some((item) => item.code === 'MISSING_INSTRUMENTS'));
});

test('canonical missing-field questions replace Copilot as the readiness source of truth', () => {
  const incomplete = reply({
    strategyDraft: {
      name: 'London Sweep', instrument: 'EURUSD', sessions: ['London'], timeframes: ['M15'],
      rules: [rule()], logicTree: { logic: 'ALL', children: ['liquidity-sweep'] }, notes: [],
    },
    unresolvedQuestions: ['What risk should be used?'],
  });
  const mapped = mapCopilotReplyToCanonicalCreation({ userMessage: 'EURUSD in London with a liquidity sweep on M15.', reply: incomplete });

  assert.equal(mapped.assessment.state, 'NEEDS_CLARIFICATION');
  assert.ok(mapped.assessment.clarifications.some((item) => item.code === 'MISSING_CONTEXT_TIMEFRAME'));
  assert.ok(mapped.assessment.clarifications.some((item) => item.code === 'MISSING_RISK_PERCENT'));
  assert.equal(mapped.assessment.clarifications.filter((item) => item.code === 'MISSING_RISK_PERCENT').length, 1);
  assert.equal(mapped.assessment.clarifications.some((item) => item.code === 'COPILOT_UNRESOLVED_INPUT'), false);
});

test('unsupported concepts remain non-executable unresolved descriptions', () => {
  const mapped = mapCopilotReplyToCanonicalCreation({
    userMessage: `${completePrompt} Also require my weekly manipulation leg.`,
    reply: reply({ unresolvedQuestions: ['Weekly manipulation leg is not in the supported rule catalog.'] }),
  });

  assert.equal(mapped.draft.values.ruleSelections.some((item) => item.key.includes('weekly')), false);
  assert.ok(mapped.draft.unresolvedInputs.some((item) => item.kind === 'UNSUPPORTED_CONCEPT' && /weekly manipulation leg/i.test(item.text)));
  assert.equal(mapped.assessment.state, 'NEEDS_CLARIFICATION');
});

test('a Copilot refinement of a sensitive field deterministically invalidates confirmation', () => {
  const first = mapCopilotReplyToCanonicalCreation({ userMessage: completePrompt, reply: reply() });
  const confirmed = confirmCanonicalCreationDraft(first.draft);
  assert.equal(confirmed.state, 'CONFIRMED');

  const refinedReply = reply({ strategyDraft: { ...reply().strategyDraft, sessions: ['New York'] } });
  const refined = mapCopilotReplyToCanonicalCreation({
    userMessage: 'Change it to New York only.',
    reply: refinedReply,
    previousDraft: confirmed,
  });

  assert.deepEqual(refined.draft.values.sessions, ['NEW_YORK']);
  assert.equal(refined.draft.provenance.sessions, 'EXPLICIT');
  assert.equal(refined.draft.reviewConfirmed, false);
  assert.equal(refined.draft.confirmedSensitiveFields.includes('sessions'), false);
  assert.equal(refined.assessment.state, 'READY_FOR_REVIEW');
});

test('explicit risk refinement is accepted but an inferred risk rewrite remains blocked', () => {
  const previous = reply().strategyDraft;
  const modelReply = { ...reply(), intent: 'UPDATE' as const, strategyDraft: { ...previous, riskPercent: 1 } };
  const silent = normalizeStrategyCopilotReply(modelReply, previous);
  assert.equal(silent.strategyDraft.riskPercent, 0.5);

  const explicit = normalizeStrategyCopilotReply(modelReply, previous, { userMessage: 'Change maximum risk to 1%.' });
  const merged = mergeStrategyCopilotDraft(previous, explicit.strategyDraft, { acceptNormalizedSensitiveChanges: true });
  assert.equal(merged.riskPercent, 1);

  const initial = confirmCanonicalCreationDraft(mapCopilotReplyToCanonicalCreation({ userMessage: completePrompt, reply: reply() }).draft);
  const mapped = mapCopilotReplyToCanonicalCreation({
    userMessage: 'Change maximum risk to 1%.',
    reply: { ...explicit, strategyDraft: merged },
    previousDraft: initial,
  });
  assert.equal(mapped.draft.values.riskPercent, 1);
  assert.equal(mapped.draft.provenance.riskPercent, 'EXPLICIT');
  assert.equal(mapped.draft.confirmedSensitiveFields.includes('riskPercent'), false);
  assert.equal(mapped.draft.reviewConfirmed, false);
});

test('Copilot mapping preserves ALL/ANY, required/optional and evaluation capability', () => {
  const structured = reply({
    strategyDraft: {
      ...reply().strategyDraft,
      rules: [
        rule(),
        rule('fair-value-gap', { requirement: 'OPTIONAL', group: 'ANY', capability: 'AUTOMATIC' }),
      ],
      logicTree: { logic: 'ALL', children: ['liquidity-sweep', 'ANY'] },
    },
  });
  const mapped = mapCopilotReplyToCanonicalCreation({
    userMessage: `${completePrompt} Fair value gap is optional, as alternative confluence.`,
    reply: structured,
  });

  assert.equal(mapped.draft.values.ruleSelections[0].requirement, 'REQUIRED');
  assert.equal(mapped.draft.values.ruleSelections[0].capability, 'AUTOMATIC');
  assert.equal(mapped.draft.values.ruleSelections[1].requirement, 'OPTIONAL');
  assert.equal(mapped.draft.values.ruleSelections[1].group, 'ANY');
  const anyGroup = mapped.draft.values.ruleTree?.children.find((node) => node.type === 'GROUP');
  assert.equal(anyGroup?.type === 'GROUP' ? anyGroup.logic : null, 'ANY');
});

test('legacy canonical provenance is retained for unchanged values during Copilot editing', () => {
  const previous = createCanonicalCreationDraft({
    intent: 'EDIT', strategyId: 'legacy-strategy',
    values: {
      name: 'Legacy', instruments: ['EURUSD'], sessions: ['LONDON'], contextTimeframe: 'H4', executionTimeframe: 'M15', methodologyIds: [],
      ruleSelections: [rule()], riskPercent: 0.5, minimumRR: 2,
    },
    provenance: {
      name: 'LEGACY', instruments: 'LEGACY', sessions: 'LEGACY', contextTimeframe: 'LEGACY', executionTimeframe: 'LEGACY',
      ruleSelections: 'LEGACY', riskPercent: 'LEGACY', minimumRR: 'LEGACY',
    },
  });
  const mapped = mapCopilotReplyToCanonicalCreation({ userMessage: 'Keep it as-is.', reply: reply({ strategyDraft: { ...reply().strategyDraft, name: 'Legacy' } }), previousDraft: previous });

  assert.equal(mapped.draft.strategyId, 'legacy-strategy');
  assert.equal(mapped.draft.provenance.instruments, 'LEGACY');
  assert.equal(mapped.draft.provenance.ruleSelections, 'LEGACY');
});

test('the route persists next session state and the builder no longer uses a shared id or XAUUSD apply fallback', () => {
  const route = readFileSync(new URL('../app/api/strategy-copilot/route.ts', import.meta.url), 'utf8');
  const builder = readFileSync(new URL('../components/StrategyBuilderV2.tsx', import.meta.url), 'utf8');

  assert.match(route, /upsertStrategyCopilotSession/);
  assert.doesNotMatch(builder, /sessionId:\s*['"]strategy-builder-v2['"]/);
  assert.doesNotMatch(builder, /selectedInstruments\[0\]\s*\?\?\s*['"]XAUUSD['"]/);
  assert.match(route, /assessCanonicalCreationDraft|mapCopilotReplyToCanonicalCreation/);
});
