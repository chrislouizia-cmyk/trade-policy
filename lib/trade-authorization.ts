export type TradeAuthorizationState = 'READY' | 'WAIT' | 'BLOCKED' | 'DATA_UNAVAILABLE';

export interface TradeAuthorizationMissingConfirmation {
  label: string;
  reason: string;
}

export interface TradeAuthorizationEligibility {
  allowed: boolean;
  eligible: boolean;
  state: TradeAuthorizationState;
  reasonCode: string;
  message: string;
  createActiveTrade: boolean;
  missingMandatoryConfirmations: TradeAuthorizationMissingConfirmation[];
  immutableSourceLink?: boolean;
  sourceDecisionId?: string;
  sourceReportId?: string;
}

export interface TradeAuthorizationInput {
  verdict?: string;
  analysisStatus?: string;
  strategyActive?: boolean;
  alreadyConverted?: boolean;
  decisionOwnerId?: string;
  currentUserId?: string;
  decisionInstrument?: string;
  decisionDirection?: string;
  requestedInstrument?: string;
  requestedDirection?: string;
  sourceDecisionId?: string;
  sourceReportId?: string;
  readinessPercentage?: number | null;
  missingMandatoryConfirmations?: TradeAuthorizationMissingConfirmation[];
}

function normalizeVerdict(verdict?: string) {
  if (!verdict) return 'WAIT';
  if (verdict === 'READY' || verdict === 'AUTHORIZED') return 'AUTHORIZED';
  if (verdict === 'REJECTED' || verdict === 'BLOCKED') return 'REJECTED';
  return verdict;
}

export function evaluateTradeAuthorizationEligibility(input: TradeAuthorizationInput): TradeAuthorizationEligibility {
  const missingMandatoryConfirmations = (input.missingMandatoryConfirmations ?? []).filter((item) => Boolean(item?.label));
  const normalizedVerdict = normalizeVerdict(input.verdict);

  if (input.alreadyConverted) {
    return {
      allowed: false,
      eligible: false,
      state: 'BLOCKED',
      reasonCode: 'TRADE_ALREADY_ACTIVATED',
      message: 'This decision is already linked to an active trade.',
      createActiveTrade: false,
      missingMandatoryConfirmations,
    };
  }

  if (input.currentUserId && input.decisionOwnerId && input.currentUserId !== input.decisionOwnerId) {
    return {
      allowed: false,
      eligible: false,
      state: 'BLOCKED',
      reasonCode: 'DECISION_OWNERSHIP_MISMATCH',
      message: 'This decision belongs to a different account.',
      createActiveTrade: false,
      missingMandatoryConfirmations,
    };
  }

  if (missingMandatoryConfirmations.length > 0) {
    return {
      allowed: false,
      eligible: false,
      state: 'WAIT',
      reasonCode: 'MISSING_MANDATORY_CONFIRMATIONS',
      message: 'Mandatory confirmations are still missing before this decision can be authorized.',
      createActiveTrade: false,
      missingMandatoryConfirmations,
    };
  }

  if (input.readinessPercentage !== undefined && input.readinessPercentage !== null && input.readinessPercentage < 100) {
    return {
      allowed: false,
      eligible: false,
      state: 'WAIT',
      reasonCode: 'READINESS_INCOMPLETE',
      message: 'The setup is not fully ready yet.',
      createActiveTrade: false,
      missingMandatoryConfirmations,
    };
  }

  if (normalizedVerdict === 'REJECTED' || input.verdict === 'BLOCKED') {
    return {
      allowed: false,
      eligible: false,
      state: 'BLOCKED',
      reasonCode: 'BLOCKED',
      message: 'The current setup conflicts with one or more trading rules.',
      createActiveTrade: false,
      missingMandatoryConfirmations,
    };
  }

  if (normalizedVerdict === 'WAIT' || input.verdict === 'WAIT') {
    return {
      allowed: false,
      eligible: false,
      state: 'WAIT',
      reasonCode: 'WAIT',
      message: 'The setup is still waiting for the required confirmations.',
      createActiveTrade: false,
      missingMandatoryConfirmations,
    };
  }

  if (input.analysisStatus && input.analysisStatus !== 'VALID_ANALYSIS') {
    return {
      allowed: false,
      eligible: false,
      state: 'DATA_UNAVAILABLE',
      reasonCode: 'DECISION_NOT_READY',
      message: 'The market analysis is not currently in a state that supports authorization.',
      createActiveTrade: false,
      missingMandatoryConfirmations,
    };
  }

  if (input.strategyActive === false) {
    return {
      allowed: false,
      eligible: false,
      state: 'DATA_UNAVAILABLE',
      reasonCode: 'DECISION_NOT_READY',
      message: 'The active strategy is no longer available for authorization.',
      createActiveTrade: false,
      missingMandatoryConfirmations,
    };
  }

  if (input.decisionInstrument && input.requestedInstrument && input.decisionInstrument !== input.requestedInstrument) {
    return {
      allowed: false,
      eligible: false,
      state: 'BLOCKED',
      reasonCode: 'DECISION_CONTEXT_MISMATCH',
      message: 'The trade instrument no longer matches the originating decision.',
      createActiveTrade: false,
      missingMandatoryConfirmations,
    };
  }

  if (input.decisionDirection && input.requestedDirection && input.decisionDirection !== input.requestedDirection) {
    return {
      allowed: false,
      eligible: false,
      state: 'BLOCKED',
      reasonCode: 'DECISION_CONTEXT_MISMATCH',
      message: 'The trade direction no longer matches the originating decision.',
      createActiveTrade: false,
      missingMandatoryConfirmations,
    };
  }

  return {
    allowed: true,
    eligible: true,
    state: 'READY',
    reasonCode: 'READY',
    message: 'The decision is ready for authorization.',
    createActiveTrade: true,
    immutableSourceLink: true,
    sourceDecisionId: input.sourceDecisionId,
    sourceReportId: input.sourceReportId,
    missingMandatoryConfirmations,
  };
}
