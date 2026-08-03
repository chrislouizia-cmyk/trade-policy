export interface TradeActivationFailureContext {
  error?: string;
  rejection?: {
    reasonCode?: string;
    message?: string;
    state?: string;
  };
}

const reasonMap: Record<string, string> = {
  SOURCE_DECISION_MISSING: 'The originating decision could not be verified.',
  SOURCE_REPORT_MISSING: 'The originating decision report could not be verified.',
  DECISION_CONTEXT_MISMATCH: 'The instrument or direction no longer matches the originating decision.',
  TRADE_ALREADY_ACTIVATED: 'This decision has already been used to create an active trade.',
  MIGRATION_NOT_APPLIED: 'The trade activation database migration is not available yet. Please apply the required Supabase migration.',
  AUTHORIZATION_EXPIRED: 'This trade authorization has expired. Run the final risk check again.',
  MISSING_MANDATORY_CONFIRMATIONS: 'Mandatory confirmations are still missing before this decision can be authorized.',
  DECISION_OWNERSHIP_MISMATCH: 'This decision belongs to a different account.',
  READINESS_INCOMPLETE: 'The setup is not fully ready yet.',
};

export function getSafeTradeActivationError(context: TradeActivationFailureContext): string {
  if (context.rejection?.message) {
    return context.rejection.message;
  }

  if (context.rejection?.reasonCode && reasonMap[context.rejection.reasonCode]) {
    return reasonMap[context.rejection.reasonCode];
  }

  if (context.error) {
    return context.error;
  }

  return 'Trade authorization could not be completed. Please try again.';
}
