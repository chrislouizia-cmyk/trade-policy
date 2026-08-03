import { evaluateTradeAuthorizationEligibility as evaluateEligibility, type TradeAuthorizationInput } from '../trade-authorization.ts';

export type TradeLifecycleStatus = 'ACTIVE' | 'OPEN' | 'CLOSED' | 'MISSED';

export interface TradeActivationInput extends TradeAuthorizationInput {
  verdict: string;
}

export interface TradeActivationOptions {
  allowOverride?: boolean;
}

export interface TradeActivationResult {
  allowed: boolean;
  status?: TradeLifecycleStatus;
  code?: string;
  createActiveTrade?: boolean;
  immutableSourceLink?: boolean;
  sourceDecisionId?: string;
  sourceReportId?: string;
  overrideMode?: 'READY' | 'OVERRIDE';
}

export interface TradeCloseInput {
  currentStatus: string;
  outcome?: string;
  exitPrice?: number;
  closedAt?: string;
}

export interface TradeCloseResult {
  allowed: boolean;
  code?: string;
  nextStatus?: 'CLOSED';
  outcome?: string;
  manageTradeVisible?: boolean;
}

export function canActivateTradeFromDecision(input: TradeActivationInput, options?: TradeActivationOptions): TradeActivationResult {
  const eligibility = evaluateEligibility({ ...input, allowOverride: options?.allowOverride });
  if (!eligibility.allowed) {
    return {
      allowed: false,
      code: eligibility.reasonCode,
      status: eligibility.state === 'READY' ? 'ACTIVE' : 'ACTIVE',
      createActiveTrade: false,
      immutableSourceLink: eligibility.immutableSourceLink,
      sourceDecisionId: eligibility.sourceDecisionId,
      sourceReportId: eligibility.sourceReportId,
      overrideMode: eligibility.overrideMode,
    };
  }

  return {
    allowed: true,
    status: 'ACTIVE',
    createActiveTrade: true,
    immutableSourceLink: true,
    sourceDecisionId: input.sourceDecisionId,
    sourceReportId: input.sourceReportId,
    overrideMode: eligibility.overrideMode ?? 'READY',
  };
}

export function evaluateTradeAuthorizationEligibility(input: TradeAuthorizationInput) {
  return evaluateEligibility(input);
}

export function resolveTradeJournalAction(input: TradeActivationInput & { mode: 'ACTIVATE' | 'MISSED' }): TradeActivationResult {
  if (input.mode === 'MISSED') {
    return { allowed: true, status: 'MISSED', createActiveTrade: false, immutableSourceLink: true, sourceDecisionId: input.sourceDecisionId, sourceReportId: input.sourceReportId };
  }

  return canActivateTradeFromDecision(input);
}

export function canCloseTrade(input: TradeCloseInput): TradeCloseResult {
  if (input.currentStatus === 'CLOSED') {
    return { allowed: false, code: 'TRADE_ALREADY_CLOSED' };
  }

  return {
    allowed: true,
    nextStatus: 'CLOSED',
    outcome: input.outcome,
    manageTradeVisible: input.currentStatus === 'OPEN',
  };
}

export function finalizeTradeLifecycle(input: TradeCloseInput): TradeCloseResult {
  return canCloseTrade(input);
}
