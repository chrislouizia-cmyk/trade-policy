import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const component = fs.readFileSync('components/StrategyBuilderV2.tsx', 'utf8');

test('create mode defaults to the canonical describe path and renders exactly two top-level choices', () => {
  assert.match(component, /mode==='EDIT'\?'visual':'copilot'/);
  assert.match(component, /STRATEGY_CREATION_ENTRY_PATHS\.map/);
  assert.match(component, /aria-label="Strategy creation entry paths"/);
  assert.doesNotMatch(component, /aria-label="Create strategy modes"/);
});

test('methodology, visual builder and blank initialization remain reachable only inside Advanced', () => {
  assert.match(component, /path === 'advanced'/);
  assert.match(component, /ADVANCED_STRATEGY_CREATION_MODES\.map/);
  assert.match(component, /enterMode\(advancedMode\)/);
  assert.match(component, /initializeMethodologyMode/);
  assert.match(component, /initializeBlankMode/);
  assert.match(component, /function initializeBlankMode\(\) \{ initializeCopilotMode\(\); \}/);
  assert.match(component, /setSelectedInstruments\(\[\]\).*setSelectedRuleSelections\(\[\]\).*setRiskPercent\(0\).*setMinimumRR\(0\)/s);
});

test('canonical readiness still gates Copilot apply and no instrument fallback is introduced', () => {
  assert.match(component, /assessCanonicalCreationDraft\(canonicalCopilotDraft\)/);
  assert.match(component, /canonicalCopilotDraft\.state !== 'CONFIRMED'/);
  assert.doesNotMatch(component, /XAUUSD.*(?:fallback|default)|(?:fallback|default).*XAUUSD/i);
});

test('edit remains bound to the selected profile and bypasses the create entry selector', () => {
  assert.match(component, /mode==='EDIT'\?'visual':'copilot'/);
  assert.match(component, /mode==='CREATE'.*STRATEGY_CREATION_ENTRY_PATHS/s);
  assert.match(component, /mode === 'EDIT' && profile\.id/);
});
