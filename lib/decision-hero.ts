import type { ChartAnalysis, TradeResult } from '@/types/trade';

export type DecisionVerdict =
  | 'ANALYZING'
  | 'READY'
  | 'WAIT'
  | 'BLOCKED'
  | 'NO SETUP'
  | 'DATA UNAVAILABLE';

export type DecisionHeroState = {
  verdict: DecisionVerdict;
  instruction: string;
  marketState: string;
  showReadiness: boolean;
  readinessPercent: number | null;
};

type DockStatus = {
  label: string;
  detail: string;
  variant: 'positive' | 'warning' | 'neutral' | 'info';
};

export function getAiDockStatus({
  analyzing,
  analysis,
  result,
  threshold,
}: {
  analyzing: boolean;
  analysis: ChartAnalysis | null;
  result: TradeResult | null;
  threshold: number;
}): DockStatus {
  if (analyzing) return { label: 'ANALYZING', detail: 'Reading configured timeframes.', variant: 'info' };
  if (!analysis) return { label: 'WATCHING MARKET', detail: 'Ready for live analysis.', variant: 'neutral' };
  if (result?.verdict === 'AUTHORIZED') return { label: 'READY', detail: 'The validation engine approved the setup.', variant: 'positive' };
  if (result?.verdict === 'REJECTED') return { label: 'BLOCKED', detail: 'A policy condition failed.', variant: 'warning' };
  if (result?.verdict === 'WAIT' || analysis.liveAnalysisConfidence == null || analysis.liveAnalysisConfidence < threshold) {
    return { label: 'WAIT', detail: 'Confirmation is incomplete.', variant: 'warning' };
  }
  if (analysis.candidates.some((candidate) => candidate.status === 'READY')) {
    return { label: 'READY', detail: 'The setup is ready for review.', variant: 'positive' };
  }
  return { label: 'WAIT', detail: 'Confirmation is incomplete.', variant: 'warning' };
}

export function getReadinessInterpretation(
  analysis: ChartAnalysis | null,
  threshold: number,
): string {
  if (!analysis) return 'Awaiting market analysis';
  if (analysis.status === 'NO_RELEVANT_EVIDENCE') return 'No valid setup detected';
  if (analysis.status === 'STRATEGY_UNSUPPORTED') return 'This strategy is not fully supported by live analysis';
  if (analysis.status === 'STRATEGY_INCOMPLETE') return 'Complete the strategy configuration';
  if (
    analysis.status === 'DATA_UNAVAILABLE'
    || analysis.status === 'INSUFFICIENT_DATA'
    || analysis.status === 'ANALYSIS_FAILED'
  ) {
    return 'Market data unavailable';
  }
  if (analysis.status === 'VALID_ANALYSIS' && analysis.liveAnalysisConfidence != null) {
    return analysis.liveAnalysisConfidence >= threshold
      ? 'Meets required readiness'
      : 'Below required readiness';
  }
  return 'Awaiting market analysis';
}

export function getDecisionHeroState({
  analyzing,
  analysis,
  result,
  threshold,
}: {
  analyzing: boolean;
  analysis: ChartAnalysis | null;
  result: TradeResult | null;
  threshold: number;
}): DecisionHeroState {
  const showReadiness = analysis?.status === 'VALID_ANALYSIS' && analysis.liveAnalysisConfidence != null;
  const readinessPercent = showReadiness ? analysis!.liveAnalysisConfidence : null;
  const marketState = getReadinessInterpretation(analysis, threshold);

  if (analyzing) {
    return {
      verdict: 'ANALYZING',
      instruction: 'Do not risk your money yet.',
      marketState: 'Reading configured timeframes',
      showReadiness: false,
      readinessPercent: null,
    };
  }

  if (!analysis) {
    return {
      verdict: 'WAIT',
      instruction: 'Do not risk your money yet.',
      marketState,
      showReadiness: false,
      readinessPercent: null,
    };
  }

  if (
    analysis.status === 'DATA_UNAVAILABLE'
    || analysis.status === 'INSUFFICIENT_DATA'
    || analysis.status === 'ANALYSIS_FAILED'
  ) {
    return {
      verdict: 'DATA UNAVAILABLE',
      instruction: 'Current market data is unavailable.',
      marketState,
      showReadiness: false,
      readinessPercent: null,
    };
  }

  if (analysis.status === 'NO_RELEVANT_EVIDENCE') {
    return {
      verdict: 'NO SETUP',
      instruction: 'No valid setup is present.',
      marketState,
      showReadiness: false,
      readinessPercent: null,
    };
  }

  const dockStatus = getAiDockStatus({ analyzing, analysis, result, threshold });

  if (result?.verdict === 'REJECTED' || dockStatus.label === 'BLOCKED') {
    return {
      verdict: 'BLOCKED',
      instruction: 'This trade conflicts with your rules.',
      marketState,
      showReadiness,
      readinessPercent,
    };
  }

  if (result?.verdict === 'AUTHORIZED' || dockStatus.label === 'READY') {
    return {
      verdict: 'READY',
      instruction: 'The setup is ready for final review.',
      marketState,
      showReadiness,
      readinessPercent,
    };
  }

  return {
    verdict: 'WAIT',
    instruction: 'Do not risk your money yet.',
    marketState,
    showReadiness,
    readinessPercent,
  };
}
