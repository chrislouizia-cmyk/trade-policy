import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayloadStopLimits,
  buildPayloadInstruments,
  createBlankStrategyDraft,
  createNewStrategyDraft,
  createStarterStrategyDraft,
  createStarterTemplateSelection,
  deriveStopLimitsForInstruments,
  hydrateDraftFromSavedProfile,
} from '../lib/strategy-builder-draft.ts';

test('blank strategy starts with zero instruments', () => {
  const draft = createBlankStrategyDraft();
  assert.deepEqual(draft.profile.instruments, []);
  assert.deepEqual(draft.stopLimits, []);
});

test('GBPUSD-only strategy shows only GBPUSD', () => {
  const draft = createBlankStrategyDraft();
  const next = hydrateDraftFromSavedProfile({ ...draft.profile, instruments: ['GBPUSD'] }, draft.stopLimits);
  assert.deepEqual(next.profile.instruments, ['GBPUSD']);
  assert.deepEqual(next.stopLimits.map((limit) => limit.instrument), ['GBPUSD']);
});

test('XAUUSD does not appear unless explicitly selected', () => {
  const draft = createBlankStrategyDraft();
  const next = hydrateDraftFromSavedProfile({ ...draft.profile, instruments: ['GBPUSD'] }, draft.stopLimits);
  assert.equal(next.profile.instruments.includes('XAUUSD'), false);
  assert.equal(next.stopLimits.some((limit) => limit.instrument === 'XAUUSD'), false);
});

test('deselecting XAUUSD removes it immediately', () => {
  const existing = [
    { instrument: 'XAUUSD', method: 'POINTS' as const, minimumValue: 80, preferredValue: 180, maximumValue: 300 },
    { instrument: 'GBPUSD', method: 'PIPS' as const, minimumValue: 10, preferredValue: 18, maximumValue: 25 },
  ];
  const next = deriveStopLimitsForInstruments(['GBPUSD'], existing);
  assert.deepEqual(next.map((limit) => limit.instrument), ['GBPUSD']);
  assert.equal(next.some((limit) => limit.instrument === 'XAUUSD'), false);
});

test('removed instrument is absent from saved payload', () => {
  const profile = { ...createBlankStrategyDraft().profile, instruments: ['GBPUSD'] };
  const stopLimits = deriveStopLimitsForInstruments(profile.instruments, [
    { instrument: 'XAUUSD', method: 'POINTS', maximumValue: 300 },
    { instrument: 'GBPUSD', method: 'PIPS', maximumValue: 25 },
  ]);
  assert.deepEqual(buildPayloadInstruments(profile.instruments), [{ symbol: 'GBPUSD', market_type: 'FOREX', provider_symbol: null, sort_order: 0, enabled: true }]);
  assert.deepEqual(buildPayloadStopLimits(profile.instruments, stopLimits), [{ instrument: 'GBPUSD', method: 'PIPS', minimum_value: 0, preferred_value: 25, maximum_value: 25, atr_multiplier: null }]);
});

test('removed instrument is absent from validation', () => {
  const draft = createBlankStrategyDraft();
  const next = hydrateDraftFromSavedProfile({ ...draft.profile, instruments: ['GBPUSD'] }, draft.stopLimits);
  assert.deepEqual(next.profile.instruments, ['GBPUSD']);
  assert.equal(next.profile.instruments.includes('XAUUSD'), false);
});

test('new strategy does not inherit prior strategy instruments', () => {
  const previous = { ...createBlankStrategyDraft().profile, instruments: ['XAUUSD', 'GBPUSD'] };
  const next = createNewStrategyDraft(previous);
  assert.deepEqual(next.profile.instruments, []);
  assert.deepEqual(next.stopLimits, []);
});

test('editing existing strategy preserves exact saved instruments', () => {
  const current = { ...createBlankStrategyDraft().profile, instruments: ['GBPUSD', 'EURUSD'] };
  const next = hydrateDraftFromSavedProfile(current, []);
  assert.deepEqual(next.profile.instruments, ['GBPUSD', 'EURUSD']);
});

test('refresh preserves only explicitly selected instruments', () => {
  const restored = hydrateDraftFromSavedProfile({ ...createBlankStrategyDraft().profile, instruments: ['GBPUSD'] }, [
    { instrument: 'XAUUSD', method: 'POINTS', maximumValue: 300 },
    { instrument: 'GBPUSD', method: 'PIPS', maximumValue: 25 },
  ]);
  assert.deepEqual(restored.profile.instruments, ['GBPUSD']);
  assert.deepEqual(restored.stopLimits.map((limit) => limit.instrument), ['GBPUSD']);
});

test('back and continue navigation does not restore stale instruments', () => {
  const draft = createBlankStrategyDraft();
  const next = hydrateDraftFromSavedProfile({ ...draft.profile, instruments: ['GBPUSD'] }, []);
  assert.deepEqual(next.profile.instruments, ['GBPUSD']);
  assert.equal(next.profile.instruments.includes('XAUUSD'), false);
});

test('starter template instruments appear only after explicit confirmation', () => {
  const selection = createStarterTemplateSelection();
  assert.deepEqual(selection.instruments, ['XAUUSD']);
  const draft = createStarterStrategyDraft();
  assert.deepEqual(draft.profile.instruments, []);
});

test('duplicating a strategy preserves instruments only when duplication was explicitly chosen', () => {
  const source = { ...createBlankStrategyDraft().profile, instruments: ['GBPUSD'] };
  const duplicated = hydrateDraftFromSavedProfile(source, []);
  assert.deepEqual(duplicated.profile.instruments, ['GBPUSD']);
});

test('stop-loss config cannot reintroduce an unselected instrument', () => {
  const next = deriveStopLimitsForInstruments(['GBPUSD'], [
    { instrument: 'XAUUSD', method: 'POINTS', maximumValue: 300 },
    { instrument: 'GBPUSD', method: 'PIPS', maximumValue: 25 },
  ]);
  assert.deepEqual(next.map((limit) => limit.instrument), ['GBPUSD']);
});

test('analysis request uses only saved selected instruments', () => {
  const payload = buildPayloadInstruments(['GBPUSD', 'EURUSD']);
  assert.deepEqual(payload.map((item) => item.symbol), ['GBPUSD', 'EURUSD']);
  assert.equal(payload.some((item) => item.symbol === 'XAUUSD'), false);
});
