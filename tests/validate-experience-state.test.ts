import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  deriveValidateExperienceState,
  type ValidateExperienceInput,
} from '../lib/validate-experience-state.ts';

const readyForFinalCheck = (overrides: Partial<ValidateExperienceInput> = {}): ValidateExperienceInput => ({
  strategyReady: true,
  analyzing: false,
  analysisStatus: 'VALID_ANALYSIS',
  hasAnalysis: true,
  hasExecutableSetup: true,
  hasValidGeometry: true,
  pendingRequiredConfirmations: 0,
  finalResult: null,
  authorizationEligibility: null,
  activating: false,
  activeTradeCreated: false,
  overrideEligible: false,
  ...overrides,
});

test('a strategy must be ready before a market check can begin', () => {
  const state = deriveValidateExperienceState(readyForFinalCheck({ strategyReady: false, hasAnalysis: false, analysisStatus: null }));
  assert.equal(state.state, 'NOT_CHECKED');
  assert.equal(state.primaryAction, 'NONE');
  assert.equal(state.canRunMarketCheck, false);
});

test('an untouched valid strategy starts at NOT_CHECKED', () => {
  const state = deriveValidateExperienceState(readyForFinalCheck({ hasAnalysis: false, analysisStatus: null, hasExecutableSetup: false, hasValidGeometry: false }));
  assert.equal(state.state, 'NOT_CHECKED');
  assert.equal(state.primaryAction, 'CHECK_MARKET');
  assert.equal(state.canRunMarketCheck, true);
});

test('market acquisition has precedence over stale analysis state', () => {
  const state = deriveValidateExperienceState(readyForFinalCheck({ analyzing: true }));
  assert.equal(state.state, 'CHECKING_MARKET');
  assert.equal(state.primaryAction, 'NONE');
});

test('unavailable and incomplete market results fail closed', () => {
  for (const analysisStatus of ['DATA_UNAVAILABLE', 'INSUFFICIENT_DATA', 'ANALYSIS_FAILED', 'STRATEGY_INCOMPLETE']) {
    const state = deriveValidateExperienceState(readyForFinalCheck({ analysisStatus }));
    assert.equal(state.state, 'DATA_UNAVAILABLE', analysisStatus);
    assert.equal(state.primaryAction, 'RETRY_MARKET', analysisStatus);
    assert.equal(state.canRunFinalRiskCheck, false, analysisStatus);
  }
});

test('a valid analysis without executable geometry needs trade details', () => {
  const state = deriveValidateExperienceState(readyForFinalCheck({ hasValidGeometry: false }));
  assert.equal(state.state, 'NEEDS_TRADE_DETAILS');
  assert.equal(state.primaryAction, 'REVIEW_TRADE_DETAILS');
  assert.equal(state.canRunFinalRiskCheck, false);
});

test('required manual evidence has precedence before the final risk check', () => {
  const state = deriveValidateExperienceState(readyForFinalCheck({ pendingRequiredConfirmations: 2 }));
  assert.equal(state.state, 'NEEDS_CONFIRMATION');
  assert.equal(state.primaryAction, 'COMPLETE_CONFIRMATIONS');
  assert.equal(state.canRunFinalRiskCheck, false);
});

test('complete setup inputs expose exactly the existing final risk check', () => {
  const state = deriveValidateExperienceState(readyForFinalCheck());
  assert.equal(state.state, 'NEEDS_TRADE_DETAILS');
  assert.equal(state.primaryAction, 'RUN_FINAL_RISK_CHECK');
  assert.equal(state.canRunFinalRiskCheck, true);
});

test('final authorization eligibility is authoritative for READY WAIT and BLOCKED', () => {
  const ready = deriveValidateExperienceState(readyForFinalCheck({
    finalResult: { verdict: 'AUTHORIZED' },
    authorizationEligibility: { allowed: true, state: 'READY', reasonCode: 'READY' },
  }));
  assert.equal(ready.state, 'READY_TO_TAKE');
  assert.equal(ready.primaryAction, 'TAKE_TRADE');

  const waiting = deriveValidateExperienceState(readyForFinalCheck({
    finalResult: { verdict: 'WAIT' },
    authorizationEligibility: { allowed: false, state: 'WAIT', reasonCode: 'MISSING_MANDATORY_CONFIRMATIONS' },
  }));
  assert.equal(waiting.state, 'WAIT');
  assert.equal(waiting.primaryAction, 'NONE');

  const blocked = deriveValidateExperienceState(readyForFinalCheck({
    finalResult: { verdict: 'REJECTED' },
    authorizationEligibility: { allowed: false, state: 'BLOCKED', reasonCode: 'BLOCKED' },
  }));
  assert.equal(blocked.state, 'BLOCKED');
  assert.equal(blocked.primaryAction, 'NONE');
});

test('override remains explicit and never changes WAIT or BLOCKED into READY', () => {
  for (const eligibilityState of ['WAIT', 'BLOCKED'] as const) {
    const state = deriveValidateExperienceState(readyForFinalCheck({
      finalResult: { verdict: eligibilityState === 'WAIT' ? 'WAIT' : 'REJECTED' },
      authorizationEligibility: { allowed: false, state: eligibilityState, reasonCode: 'OVERRIDE_REASON_REQUIRED' },
      overrideEligible: true,
    }));
    assert.equal(state.state, eligibilityState);
    assert.equal(state.primaryAction, 'TAKE_ANYWAY');
    assert.equal(state.override, true);
  }
});

test('a final result without canonical eligibility fails closed', () => {
  const state = deriveValidateExperienceState(readyForFinalCheck({ finalResult: { verdict: 'AUTHORIZED' } }));
  assert.equal(state.state, 'DATA_UNAVAILABLE');
  assert.equal(state.primaryAction, 'NONE');
});

test('activation and confirmed ACTIVE lifecycle outrank prior decision states', () => {
  const activating = deriveValidateExperienceState(readyForFinalCheck({
    finalResult: { verdict: 'AUTHORIZED' },
    authorizationEligibility: { allowed: true, state: 'READY', reasonCode: 'READY' },
    activating: true,
  }));
  assert.equal(activating.state, 'ACTIVATING');

  const active = deriveValidateExperienceState(readyForFinalCheck({
    finalResult: { verdict: 'AUTHORIZED' },
    authorizationEligibility: { allowed: true, state: 'READY', reasonCode: 'READY' },
    activating: true,
    activeTradeCreated: true,
  }));
  assert.equal(active.state, 'ACTIVE');
  assert.equal(active.primaryAction, 'OPEN_ACTIVE_TRADE');
});

test('TradeValidator consumes the canonical presentation state without replacing decision authorities', () => {
  const source = readFileSync(new URL('../components/TradeValidator.tsx', import.meta.url), 'utf8');
  assert.match(source, /deriveValidateExperienceState/);
  assert.match(source, /data-validate-state=\{validateExperience\.state\}/);
  assert.match(source, /data-validate-status/);
  assert.match(source, /validateExperience\.canRunFinalRiskCheck/);
  assert.match(source, /authorizationEligibility/);
  assert.match(source, /result\?\.verdict/);
});
