import { backtestOutcome, reportAccountName, type BacktestOutcome } from './backtest-report.ts';

export const BACKTEST_REPORT_MODEL_VERSION = '1.1.0';

export type BacktestCandidateDisposition = 'TAKEN' | 'REJECTED' | 'ABORTED' | 'OVERRIDE_ELIGIBLE';

export type BacktestCandidateEvent = Readonly<{
  candidateKey: string;
  signalTimestampUtc: string;
  direction: 'LONG' | 'SHORT' | null;
  disposition: BacktestCandidateDisposition;
  terminalStage: string;
  terminalReason: string;
  blockingRuleId: string | null;
  ruleEvaluations: readonly Record<string, unknown>[];
  officialTradeSequence: number | null;
  officialPerformance: boolean;
  hypothetical: Readonly<Record<string, unknown>> | null;
}>;

export type BacktestReportModel = Readonly<{
  version: typeof BACKTEST_REPORT_MODEL_VERSION;
  generatedAtUtc: string;
  identity: Readonly<{
    reportId: string;
    backtestId: string;
    clientName: string;
    clientEmail: string;
    strategyName: string;
    strategyId: string;
    strategyRevisionId: string;
    strategySnapshotHash: string;
  }>;
  methodology: Readonly<{
    instrument: string;
    periodStartUtc: string;
    periodEndUtc: string;
    timezone: 'UTC';
    executionTimeframe: string;
    startingBalance: number;
    engineVersion: string;
    dataProvider: string;
    dataFingerprint: string;
    executionModel: Record<string, unknown>;
    riskConfiguration: Record<string, unknown>;
  }>;
  strategy: Readonly<{
    snapshot: Record<string, unknown>;
    rules: readonly Record<string, unknown>[];
    ruleLogic: Record<string, unknown>;
  }>;
  diagnostics: Readonly<{
    funnel: Record<string, unknown>;
    ruleDiagnostics: readonly Record<string, unknown>[];
    dataCoverage: readonly Record<string, unknown>[];
    candidates: readonly BacktestCandidateEvent[];
    candidateLedgerAvailable: boolean;
  }>;
  performance: Readonly<{
    result: Record<string, unknown>;
    trades: readonly Record<string, unknown>[];
    totalTrades: number;
    outcome: BacktestOutcome;
  }>;
  audit: Readonly<{
    completedAtUtc: string | null;
    source: 'PERSISTED_BACKTEST';
    hypotheticalSeparatedFromOfficialPerformance: true;
  }>;
}>;

type ReportSource = {
  run: Record<string, unknown>;
  result: Record<string, unknown>;
  trades: readonly Record<string, unknown>[];
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> };
  generatedAt?: Date;
  candidates?: readonly (BacktestCandidateEvent | Record<string, unknown>)[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Record<string, unknown>[] : [];
}

function iso(value: unknown): string {
  const parsed = new Date(String(value ?? ''));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Backtest report source contains an invalid UTC timestamp: ${String(value)}`);
  return parsed.toISOString();
}

function normalizeCandidate(value: BacktestCandidateEvent | Record<string, unknown>): BacktestCandidateEvent {
  const item = value as Record<string, unknown>;
  return Object.freeze({
    candidateKey: String(item.candidateKey ?? item.candidate_key ?? ''),
    signalTimestampUtc: iso(item.signalTimestampUtc ?? item.signal_timestamp_utc),
    direction: item.direction === 'LONG' || item.direction === 'SHORT' ? item.direction : null,
    disposition: String(item.disposition ?? 'REJECTED') as BacktestCandidateDisposition,
    terminalStage: String(item.terminalStage ?? item.terminal_stage ?? ''),
    terminalReason: String(item.terminalReason ?? item.terminal_reason ?? ''),
    blockingRuleId: item.blockingRuleId == null && item.blocking_rule_id == null
      ? null
      : String(item.blockingRuleId ?? item.blocking_rule_id),
    ruleEvaluations: Object.freeze(records(item.ruleEvaluations ?? item.rule_evaluations)),
    officialTradeSequence: item.officialTradeSequence == null && item.official_trade_sequence == null
      ? null
      : Number(item.officialTradeSequence ?? item.official_trade_sequence),
    officialPerformance: Boolean(item.officialPerformance ?? item.official_performance),
    hypothetical: item.hypothetical == null ? null : Object.freeze(record(item.hypothetical)),
  });
}

function normalizeRuleDiagnostic(value: Record<string, unknown>): Record<string, unknown> {
  const before = Number(value.candidates_before ?? 0);
  const after = Number(value.candidates_after ?? 0);
  const candidateRuleFailed = Number(value.candidate_rule_failed ?? Math.max(0, before - after));
  const legacyObservedRejected = Number(value.rejected ?? 0);
  return Object.freeze({
    ...value,
    candidates_before: before,
    candidates_after: after,
    candidate_gate_evaluated: Number(value.candidate_gate_evaluated ?? before),
    candidate_rule_passed: Number(value.candidate_rule_passed ?? after),
    candidate_rule_failed: candidateRuleFailed,
    rejected: candidateRuleFailed,
    observed_matched: Number(value.observed_matched ?? 0),
    observed_not_matched: Number(value.observed_not_matched ?? legacyObservedRejected),
    observed_insufficient_data: Number(value.observed_insufficient_data ?? value.insufficient_data ?? 0),
  });
}

export function buildBacktestReportModel(source: ReportSource): BacktestReportModel {
  const { run, result, trades, user } = source;
  const snapshot = record(run.strategy_snapshot_json);
  const metadata = record(run.metadata);
  const candidates = (source.candidates ?? []).map(normalizeCandidate);
  const totalTrades = Number(result.total_trades ?? trades.length ?? 0);
  const runId = String(run.id ?? '');
  if (!runId) throw new Error('Backtest report source is missing its run id.');
  const generatedAt = source.generatedAt ?? (run.completed_at ? new Date(String(run.completed_at)) : new Date());

  return Object.freeze({
    version: BACKTEST_REPORT_MODEL_VERSION,
    generatedAtUtc: generatedAt.toISOString(),
    identity: Object.freeze({
      reportId: `TP-BT-${runId}`,
      backtestId: runId,
      clientName: reportAccountName(user),
      clientEmail: String(user.email ?? ''),
      strategyName: String(snapshot.name ?? run.strategy_profile_id ?? 'Unnamed strategy'),
      strategyId: String(run.strategy_profile_id ?? ''),
      strategyRevisionId: String(run.strategy_revision_id ?? ''),
      strategySnapshotHash: String(run.strategy_snapshot_hash ?? ''),
    }),
    methodology: Object.freeze({
      instrument: String(run.instrument ?? ''),
      periodStartUtc: iso(run.period_start),
      periodEndUtc: iso(run.period_end),
      timezone: 'UTC' as const,
      executionTimeframe: String(run.execution_timeframe ?? ''),
      startingBalance: Number(run.starting_balance ?? 0),
      engineVersion: String(run.engine_version ?? ''),
      dataProvider: String(run.data_provider ?? ''),
      dataFingerprint: String(run.data_revision_fingerprint || metadata.historical_data_fingerprint || ''),
      executionModel: record(run.execution_model),
      riskConfiguration: record(run.risk_configuration),
    }),
    strategy: Object.freeze({
      snapshot,
      rules: Object.freeze(records(snapshot.rules)),
      ruleLogic: record(metadata.rule_logic),
    }),
    diagnostics: Object.freeze({
      funnel: record(metadata.opportunity_funnel),
      ruleDiagnostics: Object.freeze(records(metadata.rule_diagnostics).map(normalizeRuleDiagnostic)),
      dataCoverage: Object.freeze(records(metadata.historical_data_coverage)),
      candidates: Object.freeze(candidates),
      candidateLedgerAvailable: candidates.length > 0 || (source.candidates !== undefined && Number(metadata.candidate_evidence_version ?? 0) >= 1),
    }),
    performance: Object.freeze({
      result,
      trades: Object.freeze([...trades]),
      totalTrades,
      outcome: backtestOutcome(totalTrades, metadata),
    }),
    audit: Object.freeze({
      completedAtUtc: run.completed_at ? iso(run.completed_at) : null,
      source: 'PERSISTED_BACKTEST' as const,
      hypotheticalSeparatedFromOfficialPerformance: true as const,
    }),
  });
}
