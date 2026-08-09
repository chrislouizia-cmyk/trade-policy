import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTradeActivationUiState } from '../lib/trade-activation-ui.ts';

const explanation = { verdict: 'WAIT' };

test('WAIT exposes Take Anyway before the override reason is entered', () => {
  const state = resolveTradeActivationUiState({
    authorizationEligibility: {
      allowed: false,
      eligible: false,
      state: 'WAIT',
      reasonCode: 'OVERRIDE_REASON_REQUIRED',
      message: 'A reason is required before this decision can be taken as an override.',
      createActiveTrade: false,
      missingMandatoryConfirmations: [],
    },
    hasExecutableSetup: true,
    explanation,
  });

  assert.equal(state.showCta, true);
  assert.equal(state.activationMode, 'OVERRIDE');
  assert.equal(state.actionLabel, 'Take Anyway');
});

test('READY exposes Take Trade', () => {
  const state = resolveTradeActivationUiState({
    authorizationEligibility: {
      allowed: true,
      eligible: true,
      state: 'READY',
      reasonCode: 'READY',
      message: 'Ready.',
      createActiveTrade: true,
      missingMandatoryConfirmations: [],
    },
    hasExecutableSetup: true,
    explanation: { verdict: 'READY' },
  });

  assert.equal(state.showCta, true);
  assert.equal(state.activationMode, 'READY');
  assert.equal(state.actionLabel, 'Take Trade');
});

test('BLOCKED exposes Take Anyway when an override reason is required', () => {
  const state = resolveTradeActivationUiState({
    authorizationEligibility: {
      allowed: false,
      eligible: false,
      state: 'BLOCKED',
      reasonCode: 'OVERRIDE_REASON_REQUIRED',
      message: 'A reason is required before this decision can be taken as an override.',
      createActiveTrade: false,
      missingMandatoryConfirmations: [],
    },
    hasExecutableSetup: true,
    explanation: { verdict: 'BLOCKED' },
  });

  assert.equal(state.showCta, true);
  assert.equal(state.activationMode, 'OVERRIDE');
  assert.equal(state.actionLabel, 'Take Anyway');
});

test('WAIT without the explicit override-reason contract exposes no activation CTA', () => {
  const state = resolveTradeActivationUiState({
    authorizationEligibility: {
      allowed: false,
      eligible: false,
      state: 'WAIT',
      reasonCode: 'MISSING_MANDATORY_CONFIRMATIONS',
      message: 'Required confirmations are missing.',
      createActiveTrade: false,
      missingMandatoryConfirmations: [{ label: 'Structure', reason: 'Structure is not confirmed.' }],
    },
    hasExecutableSetup: true,
    explanation,
  });

  assert.equal(state.showCta, false);
  assert.equal(state.activationMode, 'NONE');
  assert.equal(state.actionLabel, null);
});

test('DATA_UNAVAILABLE does not expose an activation CTA', () => {
  const state = resolveTradeActivationUiState({
    authorizationEligibility: {
      allowed: false,
      eligible: false,
      state: 'DATA_UNAVAILABLE',
      reasonCode: 'DECISION_NOT_READY',
      message: 'Unavailable.',
      createActiveTrade: false,
      missingMandatoryConfirmations: [],
    },
    hasExecutableSetup: false,
    explanation: { verdict: 'DATA_UNAVAILABLE' },
  });

  assert.equal(state.showCta, false);
  assert.equal(state.activationMode, 'NONE');
});
