import type { TradeAuthorizationEligibility } from '@/lib/trade-authorization';

export type TradeActivationUiMode = 'READY' | 'OVERRIDE' | 'NONE';

export interface TradeActivationUiState {
  showCta: boolean;
  actionLabel: string | null;
  actionHint: string | null;
  actionTone: 'success' | 'warning' | 'danger' | 'neutral';
  primaryActionDisabled: boolean;
  activationMode: TradeActivationUiMode;
  requiresOverrideReason: boolean;
  disabledReason: string | null;
}

export function resolveTradeActivationUiState({
  authorizationEligibility,
  hasExecutableSetup,
  explanation,
  isAnalyzing = false,
  isSaving = false,
}: {
  authorizationEligibility: TradeAuthorizationEligibility | null;
  hasExecutableSetup: boolean;
  explanation: { verdict?: string | null } | null;
  isAnalyzing?: boolean;
  isSaving?: boolean;
}): TradeActivationUiState {
  const state = authorizationEligibility?.state;
  const allowed = authorizationEligibility?.allowed === true;
  const verdict = explanation?.verdict;
  const isRenderableVerdict = Boolean(verdict && !['NO_SETUP', 'DATA_UNAVAILABLE', 'MARKET_CLOSED', 'STRATEGY_INCOMPLETE'].includes(verdict));
  const isReady = allowed && state === 'READY';
  const requiresOverrideReason =
    authorizationEligibility?.reasonCode === 'OVERRIDE_REASON_REQUIRED' &&
    (state === 'WAIT' || state === 'BLOCKED');
  const hasIntegrity = Boolean(authorizationEligibility && (isReady || requiresOverrideReason));
  const showCta = Boolean(isRenderableVerdict && explanation && hasIntegrity && hasExecutableSetup);

  if (showCta && isReady) {
    return {
      showCta: true,
      actionLabel: 'Take Trade',
      actionHint: 'Create an Active Trade from this decision.',
      actionTone: 'success',
      primaryActionDisabled: Boolean(isAnalyzing || isSaving),
      activationMode: 'READY',
      requiresOverrideReason: false,
      disabledReason: null,
    };
  }

  if (showCta && requiresOverrideReason) {
    return {
      showCta: true,
      actionLabel: 'Take Anyway',
      actionHint: 'Record the trade as an override and move to Active Trade.',
      actionTone: state === 'BLOCKED' ? 'danger' : 'warning',
      primaryActionDisabled: Boolean(isAnalyzing || isSaving),
      activationMode: 'OVERRIDE',
      requiresOverrideReason: true,
      disabledReason: null,
    };
  }

  if (!hasExecutableSetup) {
    return {
      showCta: false,
      actionLabel: null,
      actionHint: null,
      actionTone: 'neutral',
      primaryActionDisabled: true,
      activationMode: 'NONE',
      requiresOverrideReason: false,
      disabledReason: 'No executable setup is available yet.',
    };
  }

  if (state === 'DATA_UNAVAILABLE' || authorizationEligibility?.reasonCode === 'DECISION_NOT_READY') {
    return {
      showCta: false,
      actionLabel: null,
      actionHint: null,
      actionTone: 'neutral',
      primaryActionDisabled: true,
      activationMode: 'NONE',
      requiresOverrideReason: false,
      disabledReason: authorizationEligibility?.message ?? 'The market analysis could not be verified.',
    };
  }

  return {
    showCta: false,
    actionLabel: null,
    actionHint: null,
    actionTone: 'neutral',
    primaryActionDisabled: true,
    activationMode: 'NONE',
    requiresOverrideReason: false,
    disabledReason: authorizationEligibility?.message ?? 'This setup cannot be activated right now.',
  };
}
