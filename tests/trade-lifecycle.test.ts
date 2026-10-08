import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { canActivateTradeFromDecision, canActivateTradeFromDecisionV2, canCloseTrade, evaluateTradeAuthorizationEligibility, finalizeTradeLifecycle, resolveTradeJournalAction } from '../lib/server/trade-lifecycle.ts';
import { getSafeTradeActivationError } from '../lib/trade-action-errors.ts';
import { isCountableDailyTradeExecution } from '../lib/daily-trade-context-core.ts';

test('READY decision can create ACTIVE trade', () => {
  const result = canActivateTradeFromDecision({
    verdict: 'READY',
    analysisStatus: 'VALID_ANALYSIS',
    strategyActive: true,
    alreadyConverted: false,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.status, 'ACTIVE');
});

test('WAIT at 100% cannot authorize', () => {
  const result = evaluateTradeAuthorizationEligibility({
    verdict: 'WAIT',
    analysisStatus: 'VALID_ANALYSIS',
    strategyActive: true,
    alreadyConverted: false,
    readinessPercentage: 100,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.eligible, false);
  assert.equal(result.reasonCode, 'WAIT');
});

test('incomplete entry evidence cannot authorize', () => {
  const result = evaluateTradeAuthorizationEligibility({
    verdict: 'AUTHORIZED',
    analysisStatus: 'VALID_ANALYSIS',
    strategyActive: true,
    alreadyConverted: false,
    missingMandatoryConfirmations: [{ label: 'Entry evidence', reason: 'Entry evidence is still missing.' }],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'MISSING_MANDATORY_CONFIRMATIONS');
  assert.equal(result.missingMandatoryConfirmations[0].label, 'Entry evidence');
});

test('READY with all mandatory rules can authorize', () => {
  const result = evaluateTradeAuthorizationEligibility({
    verdict: 'AUTHORIZED',
    analysisStatus: 'VALID_ANALYSIS',
    strategyActive: true,
    alreadyConverted: false,
    missingMandatoryConfirmations: [],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.eligible, true);
  assert.equal(result.reasonCode, 'READY');
});

test('authorization failure leaves trade data unchanged', () => {
  const result = evaluateTradeAuthorizationEligibility({
    verdict: 'WAIT',
    analysisStatus: 'VALID_ANALYSIS',
    strategyActive: true,
    alreadyConverted: false,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.createActiveTrade, false);
  assert.equal(result.state, 'WAIT');
});

test('UI verdict and authorization eligibility cannot diverge', () => {
  const result = evaluateTradeAuthorizationEligibility({
    verdict: 'AUTHORIZED',
    analysisStatus: 'VALID_ANALYSIS',
    strategyActive: true,
    alreadyConverted: false,
    missingMandatoryConfirmations: [{ label: 'Manual confirmation', reason: 'Manual confirmation is still pending.' }],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.state, 'WAIT');
  assert.equal(result.eligible, false);
});

test('WAIT and blocked outcomes cannot create trade', () => {
  assert.equal(canActivateTradeFromDecision({ verdict: 'WAIT', analysisStatus: 'VALID_ANALYSIS', strategyActive: true, alreadyConverted: false }).allowed, false);
  assert.equal(canActivateTradeFromDecision({ verdict: 'BLOCKED', analysisStatus: 'VALID_ANALYSIS', strategyActive: true, alreadyConverted: false }).allowed, false);
  assert.equal(canActivateTradeFromDecision({ verdict: 'READY', analysisStatus: 'DATA_UNAVAILABLE', strategyActive: true, alreadyConverted: false }).allowed, false);
});

test('override activation requires a reason when explicitly requested', () => {
  const result = canActivateTradeFromDecision({ verdict: 'WAIT', analysisStatus: 'VALID_ANALYSIS', strategyActive: true, alreadyConverted: false }, { allowOverride: true });

  assert.equal(result.allowed, false);
  assert.equal(result.code, 'OVERRIDE_REASON_REQUIRED');
});

test('override activation is allowed for WAIT and BLOCKED when a reason is provided', () => {
  const wait = canActivateTradeFromDecision({ verdict: 'WAIT', analysisStatus: 'VALID_ANALYSIS', strategyActive: true, alreadyConverted: false, overrideReason: 'The market structure changed.' }, { allowOverride: true });
  const blocked = canActivateTradeFromDecision({ verdict: 'BLOCKED', analysisStatus: 'VALID_ANALYSIS', strategyActive: true, alreadyConverted: false, overrideReason: 'The setup still fits the plan.' }, { allowOverride: true });

  assert.equal(wait.allowed, true);
  assert.equal(wait.overrideMode, 'OVERRIDE');
  assert.equal(blocked.allowed, true);
  assert.equal(blocked.overrideMode, 'OVERRIDE');
});

test('data unavailable cannot be overridden', () => {
  const result = canActivateTradeFromDecision({ verdict: 'WAIT', analysisStatus: 'DATA_UNAVAILABLE', strategyActive: true, alreadyConverted: false }, { allowOverride: true });

  assert.equal(result.allowed, false);
  assert.equal(result.code, 'DECISION_NOT_READY');
});

test('duplicate activation is blocked', () => {
  const result = canActivateTradeFromDecision({
    verdict: 'READY',
    analysisStatus: 'VALID_ANALYSIS',
    strategyActive: true,
    alreadyConverted: true,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, 'TRADE_ALREADY_ACTIVATED');
});

test('another user cannot activate the decision', () => {
  const result = canActivateTradeFromDecision({
    verdict: 'READY',
    analysisStatus: 'VALID_ANALYSIS',
    strategyActive: true,
    alreadyConverted: false,
    decisionOwnerId: 'owner-id',
    currentUserId: 'viewer-id',
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, 'DECISION_OWNERSHIP_MISMATCH');
});

test('source instrument and direction mismatch is blocked', () => {
  const result = canActivateTradeFromDecision({
    verdict: 'READY',
    analysisStatus: 'VALID_ANALYSIS',
    strategyActive: true,
    alreadyConverted: false,
    decisionOwnerId: 'owner-id',
    currentUserId: 'owner-id',
    decisionInstrument: 'XAUUSD',
    decisionDirection: 'BUY',
    requestedInstrument: 'GBPUSD',
    requestedDirection: 'SELL',
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, 'DECISION_CONTEXT_MISMATCH');
});

test('MISSED does not create an active trade', () => {
  const result = resolveTradeJournalAction({ mode: 'MISSED', verdict: 'READY', analysisStatus: 'VALID_ANALYSIS', strategyActive: true, alreadyConverted: false });

  assert.equal(result.createActiveTrade, false);
  assert.equal(result.status, 'MISSED');
});

test('closing an ACTIVE trade updates lifecycle correctly', () => {
  const result = finalizeTradeLifecycle({ currentStatus: 'OPEN', outcome: 'WIN', exitPrice: 2000, closedAt: '2026-08-02T00:00:00.000Z' });

  assert.equal(result.allowed, true);
  assert.equal(result.nextStatus, 'CLOSED');
  assert.equal(result.outcome, 'WIN');
});

test('closed trade cannot be closed twice', () => {
  const result = canCloseTrade({ currentStatus: 'CLOSED' });

  assert.equal(result.allowed, false);
  assert.equal(result.code, 'TRADE_ALREADY_CLOSED');
});

test('active trade appears in Manage Trade when it is still open', () => {
  const result = canCloseTrade({ currentStatus: 'OPEN' });

  assert.equal(result.allowed, true);
  assert.equal(result.manageTradeVisible, true);
});

test('source decision remains linked and immutable', () => {
  const result = resolveTradeJournalAction({
    mode: 'ACTIVATE',
    verdict: 'READY',
    analysisStatus: 'VALID_ANALYSIS',
    strategyActive: true,
    alreadyConverted: false,
    sourceDecisionId: 'decision-source-id',
    sourceReportId: 'decision-report-id',
  });

  assert.equal(result.sourceDecisionId, 'decision-source-id');
  assert.equal(result.sourceReportId, 'decision-report-id');
  assert.equal(result.immutableSourceLink, true);
});

test('server failures surface a safe actionable reason', () => {
  const message = getSafeTradeActivationError({
    error: 'The originating decision could not be verified.',
    rejection: { reasonCode: 'SOURCE_DECISION_MISSING', message: 'The originating decision could not be verified.' },
  });

  assert.equal(message, 'The originating decision could not be verified.');
});

test('legacy close route verifies the canonical closed trade before reporting success', () => {
  const route = fs.readFileSync('app/api/trades/close/route.ts', 'utf8');
  assert.match(route, /close_active_trade_with_ledger/);
  assert.match(route, /status !== 'CLOSED'/);
  assert.match(route, /TRADE_CLOSE_CANONICAL_CONFIRMED/);
  assert.match(route, /'Cache-Control': 'no-store'/);
});

test('EXECUTED trade records without a successful active-trade link do not count toward daily limits', () => {
  const executedWithoutActivation = {
    id: 'row-1',
    source: 'EXECUTED',
    status: 'OPEN',
    instrument: 'XAUUSD',
    created_at: '2026-08-21T12:00:00.000Z',
    strategy_profile_id: 'strategy-a',
  };

  assert.equal(isCountableDailyTradeExecution(executedWithoutActivation, new Set()), false);
  assert.equal(isCountableDailyTradeExecution({ ...executedWithoutActivation, source: 'SUGGESTED' }, new Set(['row-1'])), false);
});

test('EXECUTED trade records linked to a successful active trade count once toward daily limits', () => {
  const executedWithActivation = {
    id: 'row-2',
    source: 'EXECUTED',
    status: 'OPEN',
    instrument: 'XAUUSD',
    created_at: '2026-08-21T12:30:00.000Z',
    strategy_profile_id: 'strategy-a',
  };

  assert.equal(isCountableDailyTradeExecution(executedWithActivation, new Set(['row-2'])), true);
  assert.equal(isCountableDailyTradeExecution(executedWithActivation, new Set(['row-2', 'row-3'])), true);
  assert.equal(isCountableDailyTradeExecution({ ...executedWithActivation, status: 'CLOSED' }, new Set(['row-2'])), true);
});
