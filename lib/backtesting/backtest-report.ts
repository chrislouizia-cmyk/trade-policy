export type BacktestOutcomeCode =
  | 'COMPLETED_WITH_TRADES'
  | 'ZERO_NO_MARKET_CONTEXT'
  | 'ZERO_NO_RULE_CONVERGENCE'
  | 'ZERO_ANALYSIS_ERRORS'
  | 'ZERO_NO_READY_CANDIDATE'
  | 'ZERO_EXECUTION_FILTERED'
  | 'ZERO_INCONCLUSIVE';

export type BacktestOutcome = Readonly<{
  code: BacktestOutcomeCode;
  title: string;
  explanation: string;
  successful: boolean;
}>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function count(source: Record<string, unknown>, key: string): number {
  const value = Number(source[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function backtestOutcome(totalTradesValue: unknown, metadataValue: unknown): BacktestOutcome {
  const totalTrades = Number(totalTradesValue ?? 0);
  if (Number.isFinite(totalTrades) && totalTrades > 0) return {
    code: 'COMPLETED_WITH_TRADES',
    title: 'Historical replay completed with simulated trades',
    explanation: `${totalTrades} simulated trade${totalTrades === 1 ? '' : 's'} passed the saved strategy rules and execution checks.`,
    successful: true,
  };

  const metadata = record(metadataValue);
  const funnel = record(metadata.opportunity_funnel);
  const hasFunnel = Object.keys(funnel).length > 0;
  const evaluated = count(funnel, 'execution_candles_evaluated');
  const contextReady = count(funnel, 'multi_timeframe_context_ready');
  const analysisCompleted = count(funnel, 'analysis_completed');
  const analysisErrors = count(funnel, 'analysis_errors');
  const ruleRejections = count(funnel, 'rejected_historical_rules');
  const readyCandidates = count(funnel, 'ready_candidate_found');
  const executableSignals = count(funnel, 'executable_signals');

  if (!hasFunnel) return {
    code: 'ZERO_INCONCLUSIVE',
    title: 'Zero trades recorded; diagnostic evidence is incomplete',
    explanation: 'This earlier run did not persist the stage-by-stage funnel required to prove why no trades were produced. Run the backtest again to generate the full rule audit.',
    successful: false,
  };
  if (!evaluated || !contextReady) return {
    code: 'ZERO_NO_MARKET_CONTEXT',
    title: 'No usable historical market context was available',
    explanation: 'The replay did not obtain enough synchronized historical candles to evaluate the strategy. This is a data-coverage result, not evidence that the strategy found no trades.',
    successful: false,
  };
  if (analysisErrors > 0 && analysisCompleted === 0) return {
    code: 'ZERO_ANALYSIS_ERRORS',
    title: 'Strategy analysis did not complete',
    explanation: `${analysisErrors.toLocaleString()} analysis attempt${analysisErrors === 1 ? '' : 's'} failed before candidate evaluation. The zero-trade result is not conclusive.`,
    successful: false,
  };
  if (ruleRejections > 0 && analysisCompleted === 0) return {
    code: 'ZERO_NO_RULE_CONVERGENCE',
    title: 'Required rules never converged in the same eligible setup',
    explanation: `${ruleRejections.toLocaleString()} synchronized market context${ruleRejections === 1 ? ' was' : 's were'} rejected by one or more required strategy rules before candidate analysis. Review the rule audit to identify the blocking conditions.`,
    successful: true,
  };
  if (analysisCompleted > 0 && readyCandidates === 0) return {
    code: 'ZERO_NO_READY_CANDIDATE',
    title: 'Market analysis completed, but no READY candidate was produced',
    explanation: `${analysisCompleted.toLocaleString()} eligible context${analysisCompleted === 1 ? ' was' : 's were'} analyzed. None produced a candidate that satisfied the saved setup requirements.`,
    successful: true,
  };
  if (readyCandidates > 0 && executableSignals === 0) return {
    code: 'ZERO_EXECUTION_FILTERED',
    title: 'Candidates were found, but execution controls rejected them',
    explanation: `${readyCandidates.toLocaleString()} READY candidate${readyCandidates === 1 ? ' was' : 's were'} found, but direction, daily limits, readiness, or risk geometry prevented execution.`,
    successful: true,
  };
  return {
    code: 'ZERO_INCONCLUSIVE',
    title: 'Zero trades recorded; diagnostic evidence is incomplete',
    explanation: 'This completed run does not contain enough stage-by-stage evidence to prove whether the market produced no setups or an earlier filter blocked evaluation. Run the backtest again to generate the full rule audit.',
    successful: false,
  };
}

export function reportAccountName(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }): string {
  const metadata = record(user.user_metadata);
  for (const value of [metadata.full_name, metadata.name, metadata.display_name]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return user.email?.split('@')[0] || 'Trade Police client';
}
