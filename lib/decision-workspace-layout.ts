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
  const hasDecision = Boolean(explanation?.verdict);
  const shouldShowDecisionColumn = Boolean(
    analysis &&
      hasDecision &&
      (analysis.status === 'VALID_ANALYSIS' || ['WAIT', 'BLOCKED'].includes(explanation?.verdict ?? '')),
  );
  const hasNarrative = Boolean(narrative);

  if (!analysis || !shouldShowDecisionColumn || (!hasNarrative && !['WAIT', 'BLOCKED'].includes(explanation?.verdict ?? ''))) {
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
