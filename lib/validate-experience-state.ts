export type ValidateExperienceState =
  | 'NOT_CHECKED'
  | 'CHECKING_MARKET'
  | 'NEEDS_TRADE_DETAILS'
  | 'NEEDS_CONFIRMATION'
  | 'READY_TO_TAKE'
  | 'WAIT'
  | 'BLOCKED'
  | 'DATA_UNAVAILABLE'
  | 'ACTIVATING'
  | 'ACTIVE';

export type ValidateExperienceAction =
  | 'NONE'
  | 'CHECK_MARKET'
  | 'RETRY_MARKET'
  | 'REVIEW_TRADE_DETAILS'
  | 'COMPLETE_CONFIRMATIONS'
  | 'RUN_FINAL_RISK_CHECK'
  | 'TAKE_TRADE'
  | 'TAKE_ANYWAY'
  | 'OPEN_ACTIVE_TRADE';

export type ValidateExperienceInput = {
  strategyReady: boolean;
  analyzing: boolean;
  analysisStatus?: string | null;
  hasAnalysis: boolean;
  hasExecutableSetup: boolean;
  hasValidGeometry: boolean;
  pendingRequiredConfirmations: number;
  finalResult: { verdict?: string | null } | null;
  authorizationEligibility: {
    allowed: boolean;
    state: 'READY' | 'WAIT' | 'BLOCKED' | 'DATA_UNAVAILABLE';
    reasonCode: string;
  } | null;
  activating: boolean;
  activeTradeCreated: boolean;
  overrideEligible: boolean;
};

export type ValidateExperienceAssessment = {
  state: ValidateExperienceState;
  phase: 'MARKET' | 'SETUP' | 'DECISION' | 'LIFECYCLE';
  primaryAction: ValidateExperienceAction;
  label: string;
  guidance: string;
  canRunMarketCheck: boolean;
  canRunFinalRiskCheck: boolean;
  override: boolean;
};

const unavailableAnalysisStatuses = new Set([
  'DATA_UNAVAILABLE',
  'INSUFFICIENT_DATA',
  'ANALYSIS_FAILED',
  'STRATEGY_INCOMPLETE',
  'STRATEGY_UNSUPPORTED',
]);

function assessment(
  state: ValidateExperienceState,
  phase: ValidateExperienceAssessment['phase'],
  primaryAction: ValidateExperienceAction,
  label: string,
  guidance: string,
  options: Partial<Pick<ValidateExperienceAssessment, 'canRunMarketCheck' | 'canRunFinalRiskCheck' | 'override'>> = {},
): ValidateExperienceAssessment {
  return {
    state,
    phase,
    primaryAction,
    label,
    guidance,
    canRunMarketCheck: false,
    canRunFinalRiskCheck: false,
    override: false,
    ...options,
  };
}
/**
 * Presentation-only state for the Validate journey.
 *
 * This function does not calculate evidence, a verdict, or activation
 * eligibility. It only translates the existing canonical authorities into
 * one stable customer-facing state and fails closed when an authority is
 * missing or contradictory.
 */
export function deriveValidateExperienceState(input: ValidateExperienceInput): ValidateExperienceAssessment {
  if (input.activeTradeCreated) {
    return assessment('ACTIVE', 'LIFECYCLE', 'OPEN_ACTIVE_TRADE', 'Trade active', 'Open the active trade to continue managing it.');
  }

  if (input.activating) {
    return assessment('ACTIVATING', 'LIFECYCLE', 'NONE', 'Adding trade', 'Trade Police is confirming the active trade.');
  }

  if (input.analyzing) {
    return assessment('CHECKING_MARKET', 'MARKET', 'NONE', 'Checking current market', 'Trade Police is reading fresh market evidence against the selected strategy.');
  }

  if (!input.strategyReady) {
    return assessment('NOT_CHECKED', 'MARKET', 'NONE', 'Strategy not ready', 'Finish loading or configuring the selected strategy before checking the market.');
  }

  if (!input.hasAnalysis) {
    return assessment('NOT_CHECKED', 'MARKET', 'CHECK_MARKET', 'Market not checked', 'Check the current market to begin.', { canRunMarketCheck: true });
  }

  if (!input.analysisStatus || unavailableAnalysisStatuses.has(input.analysisStatus)) {
    return assessment('DATA_UNAVAILABLE', 'MARKET', 'RETRY_MARKET', 'Market evidence unavailable', 'Try the market check again when fresh data is available.', { canRunMarketCheck: true });
  }

  if (input.analysisStatus === 'NO_RELEVANT_EVIDENCE') {
    return assessment('WAIT', 'SETUP', 'CHECK_MARKET', 'No setup right now', 'Wait for a setup that satisfies the selected strategy.', { canRunMarketCheck: true });
  }

  if (input.analysisStatus !== 'VALID_ANALYSIS') {
    return assessment('DATA_UNAVAILABLE', 'MARKET', 'NONE', 'Market evidence unavailable', 'Trade Police could not verify this market check.');
  }

  if (input.finalResult) {
    const eligibility = input.authorizationEligibility;
    if (!eligibility) {
      return assessment('DATA_UNAVAILABLE', 'DECISION', 'NONE', 'Decision unavailable', 'The final decision could not be verified. Run a fresh final risk check.');
    }

    if (eligibility.state === 'READY' && eligibility.allowed) {
      return assessment('READY_TO_TAKE', 'DECISION', 'TAKE_TRADE', 'Ready to take', 'Final evidence and risk controls permit this trade.');
    }

    if (eligibility.state === 'DATA_UNAVAILABLE') {
      return assessment('DATA_UNAVAILABLE', 'DECISION', 'NONE', 'Decision unavailable', eligibility.reasonCode === 'DECISION_NOT_READY' ? 'Run a fresh market check before deciding.' : 'The final decision could not be verified.');
    }

    const override = input.overrideEligible && eligibility.reasonCode === 'OVERRIDE_REASON_REQUIRED';
    if (eligibility.state === 'WAIT') {
      return assessment('WAIT', 'DECISION', override ? 'TAKE_ANYWAY' : 'NONE', 'Wait', 'Required confirmation is still missing.', { override });
    }

    return assessment('BLOCKED', 'DECISION', override ? 'TAKE_ANYWAY' : 'NONE', 'Blocked', 'A mandatory rule or risk control prevents this trade.', { override });
  }

  if (!input.hasExecutableSetup || !input.hasValidGeometry) {
    return assessment('NEEDS_TRADE_DETAILS', 'SETUP', 'REVIEW_TRADE_DETAILS', 'Review trade details', 'Select a complete setup with valid entry, stop and target.');
  }

  if (input.pendingRequiredConfirmations > 0) {
    return assessment('NEEDS_CONFIRMATION', 'SETUP', 'COMPLETE_CONFIRMATIONS', 'Confirmation needed', 'Complete the required manual confirmations before the final risk check.');
  }

  return assessment('NEEDS_TRADE_DETAILS', 'SETUP', 'RUN_FINAL_RISK_CHECK', 'Ready for final risk check', 'Review the trade details, then run the final risk check.', { canRunFinalRiskCheck: true });
}
