import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STRATEGY_PROFILE, type StrategyProfile } from '../types/trade.ts';
import {
  V2_METADATA_PERSONAL_RULE_KEY,
  V2_SUPPORTED_SESSION_CODES,
  persistedSessionToV2Session,
  persistedStrategyToV2State,
  v2SessionToPersistedSession,
  v2StateToPersistedStrategy,
  type StrategyBuilderV2State,
} from '../lib/strategy-builder-v2-persistence.ts';

const base = (): StrategyProfile => structuredClone(DEFAULT_STRATEGY_PROFILE);
const state = (): StrategyBuilderV2State => ({
  instruments: ['EURUSD', 'NAS100'], sessions: ['LONDON', 'NEW_YORK_AM'],
  contextTimeframe: 'H4', executionTimeframe: 'M5', methodologyIds: ['smc', 'breakouts'],
  ruleSelections: [
    { key: 'trend', label: 'Trend', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'H4', group: 'ALL', description: 'direction' },
    { key: 'sweep', label: 'Sweep', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'trigger' },
    { key: 'retest', label: 'Retest', capability: 'EXTERNAL', requirement: 'REQUIRED', timeframe: 'M5', group: 'ANY', description: 'confirm' },
    { key: 'target', label: 'Target', capability: 'DESCRIPTIVE', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ALL', description: 'note' },
  ],
  ruleTree: { type: 'GROUP', logic: 'ALL', children: [
    { type: 'CONDITION', ruleKey: 'trend', requirement: 'REQUIRED', timeframe: 'H4' },
    { type: 'GROUP', logic: 'ANY', children: [
      { type: 'CONDITION', ruleKey: 'sweep', requirement: 'OPTIONAL', timeframe: 'M5' },
      { type: 'GROUP', logic: 'ALL', children: [
        { type: 'CONDITION', ruleKey: 'retest', requirement: 'REQUIRED', timeframe: 'M5' },
        { type: 'CONDITION', ruleKey: 'target', requirement: 'OPTIONAL', timeframe: 'M5' },
      ] },
    ] },
  ] },
  riskPercent: 0.75, minimumRR: 2.5,
  stopLogic: { kind: 'STRUCTURAL_WITH_LIMITS', limits: [{ instrument: 'EURUSD', method: 'PIPS', minimumValue: 5, preferredValue: 12, maximumValue: 20 }], note: 'below swing' },
  targetLogic: { kind: 'MULTI_TARGET', exitConfig: { partialAtR: 2, trailAfterR: 3 }, targets: ['2R', 'runner'] },
  direction: 'LONG',
});

test('full V2 state round-trips losslessly including a recursive rule tree', () => {
  const input = state(); const persisted = v2StateToPersistedStrategy(base(), input);
  const hydrated = persistedStrategyToV2State(persisted.profile, persisted.rules, persisted.sessions);
  assert.deepEqual(hydrated, input);
  assert.deepEqual(hydrated.ruleTree, input.ruleTree);
  assert.equal(persisted.profile.stopLimitSettings?.[0].maximumValue, 20);
  assert.equal(persisted.profile.stopLimits.EURUSD, 20);
  assert.deepEqual(persisted.profile.exitConfig, { partialAtR: 2, trailAfterR: 3 });
});

test('empty state remains empty and does not invent defaults', () => {
  const empty: StrategyBuilderV2State = { instruments: [], sessions: [], methodologyIds: [], ruleSelections: [], riskPercent: 0, minimumRR: 0 };
  const persisted = v2StateToPersistedStrategy(base(), empty);
  const hydrated = persistedStrategyToV2State(persisted.profile, persisted.rules, persisted.sessions);
  assert.deepEqual(hydrated, empty);
  assert.deepEqual(persisted.profile.instruments, []);
  assert.deepEqual(persisted.profile.allowedSessions, []);
  assert.equal(hydrated.ruleTree, undefined);
});

test('every supported session maps deterministically in both directions and unknown values fail explicitly', () => {
  for (const code of V2_SUPPORTED_SESSION_CODES) {
    const row = v2SessionToPersistedSession(code);
    assert.equal(persistedSessionToV2Session(row), code);
  }
  assert.throws(() => v2SessionToPersistedSession('NOT_A_SESSION'));
});

test('metadata is stable, isolated, and preserves unrelated personal rules', () => {
  const profile = base(); profile.personalRules = [{ key: 'trader-note', enabled: true, value: 'keep this' }];
  const first = v2StateToPersistedStrategy(profile, state());
  const second = v2StateToPersistedStrategy(profile, state());
  const metadata = first.profile.personalRules?.find(rule => rule.key === V2_METADATA_PERSONAL_RULE_KEY);
  assert.deepEqual(first.profile.personalRules?.find(rule => rule.key === 'trader-note'), profile.personalRules[0]);
  assert.equal(metadata?.value, second.profile.personalRules?.find(rule => rule.key === V2_METADATA_PERSONAL_RULE_KEY)?.value);
  assert.deepEqual(JSON.parse(String(metadata?.value)).kind, 'TRADE_POLICE_V2_METADATA');
});

test('legacy hydration only reads fields that already exist and does not invent V2 defaults', () => {
  const legacy = base(); legacy.instruments = []; legacy.allowedSessions = ['CUSTOM_LEGACY']; legacy.macroTimeframe = undefined; legacy.strategyMethodologies = [];
  legacy.stopLimitSettings = []; legacy.exitConfig = {};
  const hydrated = persistedStrategyToV2State(legacy, [], []);
  assert.deepEqual(hydrated.instruments, []);
  assert.deepEqual(hydrated.sessions, ['CUSTOM_LEGACY']);
  assert.deepEqual(hydrated.methodologyIds, []);
  assert.deepEqual(hydrated.ruleSelections, []);
  assert.equal(hydrated.ruleTree, undefined);
  assert.equal(hydrated.contextTimeframe, undefined);
  assert.equal(hydrated.stopLogic, undefined);
  assert.equal(hydrated.targetLogic, undefined);
});

test('adapter does not mutate state, profile, rules, session rows, or nested logic objects', () => {
  const input = state(); const profile = base(); const rules = [{ ruleKey: 'legacy', label: 'Legacy', enabled: true, mandatory: true, weight: 1, minimumConfidence: 1, timeframeRole: 'ENTRY' as const }];
  const sessionRows = [v2SessionToPersistedSession('LONDON')];
  const inputBefore = structuredClone(input), profileBefore = structuredClone(profile), rulesBefore = structuredClone(rules), sessionsBefore = structuredClone(sessionRows);
  const persisted = v2StateToPersistedStrategy(profile, input);
  persistedStrategyToV2State(profile, rules, sessionRows);
  assert.deepEqual(input, inputBefore); assert.deepEqual(profile, profileBefore); assert.deepEqual(rules, rulesBefore); assert.deepEqual(sessionRows, sessionsBefore);
  assert.notEqual(persisted.metadata.ruleSelections, input.ruleSelections);
});
