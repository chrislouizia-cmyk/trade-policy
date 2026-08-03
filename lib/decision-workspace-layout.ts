export type DecisionWorkspaceLayoutMode = 'split' | 'full-width';

export type DecisionWorkspaceLayoutState = {
  mode: DecisionWorkspaceLayoutMode;
  showDecisionColumn: boolean;
  showDecisionReportButton: boolean;
};

export function getDecisionWorkspaceLayoutState({
  analysis,
  explanation,
  narrative,
}: {
  analysis: { status?: string } | null;
  explanation: { verdict?: string } | null;
  narrative: { reasons?: unknown[]; missingEvidence?: unknown[]; nextActions?: unknown[] } | null;
}): DecisionWorkspaceLayoutState {
  const isUnavailable = analysis?.status === 'DATA_UNAVAILABLE' || analysis?.status === 'INSUFFICIENT_DATA' || analysis?.status === 'ANALYSIS_FAILED';
  const hasCompletedDecision = Boolean(
    explanation &&
      explanation.verdict &&
      !['DATA_UNAVAILABLE', 'MARKET_CLOSED', 'STRATEGY_INCOMPLETE', 'WAIT', 'BLOCKED', 'NO SETUP', 'NO_SETUP'].includes(explanation.verdict) &&
      analysis?.status === 'VALID_ANALYSIS',
  );
  const hasNarrative = Boolean(narrative);

  if (!analysis || isUnavailable || !hasCompletedDecision || !hasNarrative) {
    return {
      mode: 'full-width',
      showDecisionColumn: false,
      showDecisionReportButton: false,
    };
  }

  return {
    mode: 'split',
    showDecisionColumn: true,
    showDecisionReportButton: true,
  };
}
