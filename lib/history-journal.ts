import { isTradeLifecycleSimulationRecord } from './trade-lifecycle-v2-core.ts';

export type HistoryDecisionRow = {
  id: string;
  created_at: string;
  instrument: string;
  timeframe: string;
  strategy_id: string | null;
  strategy_name: string;
  verdict: string;
  primary_reason: string;
  data_freshness: string | null;
  market_provider: string | null;
  readiness_percent: number | string | null;
  snapshot_json: Record<string, unknown> | null;
};

export type HistoryTradeRow = {
  id: string;
  trade_record_id: string | null;
  instrument: string;
  direction: 'BUY' | 'SELL';
  entry: number | string;
  stop_loss: number | string;
  take_profit: number | string;
  risk_percent: number | string | null;
  initial_rr: number | string | null;
  setup_type: string | null;
  status: 'OPEN' | 'CLOSED';
  current_r: number | string | null;
  taken_against_verdict: boolean | null;
  original_verdict: string | null;
  original_verdict_reason: string | null;
  override_reason: string | null;
  close_price: number | string | null;
  result_r: number | string | null;
  outcome: string | null;
  opened_at: string;
  closed_at: string | null;
  strategy_profile_id: string | null;
  strategy_name_at_entry: string | null;
  strategy_snapshot: Record<string, unknown> | null;
  strategy_revision_id: string | null;
  source_report_id: string | null;
  activation_mode: string | null;
};

export type HistoryDecisionItem = {
  kind: 'DECISION';
  id: string;
  occurredAt: string;
  instrument: string;
  timeframe: string;
  strategyId: string | null;
  strategyName: string;
  verdict: string;
  primaryReason: string;
  freshness: string | null;
  provider: string | null;
  readinessPercent: number | null;
};

export type HistoryTradeItem = {
  kind: 'TRADE';
  id: string;
  occurredAt: string;
  openedAt: string;
  closedAt: string | null;
  instrument: string;
  direction: 'BUY' | 'SELL';
  strategyId: string | null;
  strategyName: string;
  strategyRevisionId: string | null;
  status: 'OPEN' | 'CLOSED';
  outcome: string | null;
  resultR: number | null;
  currentR: number | null;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskPercent: number | null;
  initialRR: number | null;
  setupType: string | null;
  takenAgainstVerdict: boolean;
  originalVerdict: string | null;
  originalVerdictReason: string | null;
  overrideReason: string | null;
  sourceReportId: string | null;
  linkedDecision: HistoryDecisionItem | null;
};

export type HistoryJournalItem = HistoryDecisionItem | HistoryTradeItem;

export type HistoryJournalFilters = {
  q?: string;
  verdict?: string;
  instrument?: string;
  strategy?: string;
  status?: string;
  result?: string;
  from?: string;
  to?: string;
};

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function isSimulationDecision(row: Pick<HistoryDecisionRow, 'snapshot_json'>): boolean {
  const snapshot = record(row.snapshot_json);
  const mode = String(snapshot.simulationMode ?? snapshot.testSource ?? snapshot.internalTestMode ?? '').trim();
  return mode === 'INTERNAL_LIFECYCLE_SMOKE_TEST' || mode === 'SIMULATION';
}

function decisionItem(row: HistoryDecisionRow): HistoryDecisionItem | null {
  if (!validDate(row.created_at) || isSimulationDecision(row)) return null;
  return {
    kind: 'DECISION',
    id: row.id,
    occurredAt: row.created_at,
    instrument: row.instrument,
    timeframe: row.timeframe,
    strategyId: row.strategy_id,
    strategyName: row.strategy_name || 'Strategy not recorded',
    verdict: row.verdict,
    primaryReason: row.primary_reason || 'No primary reason was recorded for this decision.',
    freshness: row.data_freshness,
    provider: row.market_provider,
    readinessPercent: finite(row.readiness_percent),
  };
}

function strategyName(row: HistoryTradeRow): string {
  if (row.strategy_name_at_entry?.trim()) return row.strategy_name_at_entry;
  const snapshot = record(row.strategy_snapshot);
  return typeof snapshot.name === 'string' && snapshot.name.trim() ? snapshot.name : 'Strategy not saved';
}

function tradeItem(row: HistoryTradeRow, decisions: ReadonlyMap<string, HistoryDecisionItem>): HistoryTradeItem | null {
  if (!validDate(row.opened_at) || isTradeLifecycleSimulationRecord(row)) return null;
  const entry = finite(row.entry), stopLoss = finite(row.stop_loss), takeProfit = finite(row.take_profit);
  if (entry === null || stopLoss === null || takeProfit === null) return null;
  const linkedDecision = row.source_report_id ? decisions.get(row.source_report_id) ?? null : null;
  return {
    kind: 'TRADE',
    id: row.id,
    occurredAt: validDate(row.closed_at) ? row.closed_at : row.opened_at,
    openedAt: row.opened_at,
    closedAt: validDate(row.closed_at) ? row.closed_at : null,
    instrument: row.instrument,
    direction: row.direction,
    strategyId: row.strategy_profile_id,
    strategyName: strategyName(row),
    strategyRevisionId: row.strategy_revision_id,
    status: row.status,
    outcome: row.outcome,
    resultR: finite(row.result_r),
    currentR: finite(row.current_r),
    entry,
    stopLoss,
    takeProfit,
    riskPercent: finite(row.risk_percent),
    initialRR: finite(row.initial_rr),
    setupType: row.setup_type,
    takenAgainstVerdict: row.taken_against_verdict === true || row.activation_mode === 'OVERRIDE',
    originalVerdict: row.original_verdict ?? linkedDecision?.verdict ?? null,
    originalVerdictReason: row.original_verdict_reason ?? linkedDecision?.primaryReason ?? null,
    overrideReason: row.override_reason,
    sourceReportId: row.source_report_id,
    linkedDecision,
  };
}

function newestFirst<T extends { occurredAt: string }>(items: T[]): T[] {
  return items.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
}

export function buildHistoryJournal(tradeRows: HistoryTradeRow[], decisionRows: HistoryDecisionRow[]) {
  const decisions = decisionRows.map(decisionItem).filter((item): item is HistoryDecisionItem => item !== null);
  const decisionMap = new Map(decisions.map((item) => [item.id, item]));
  const trades = tradeRows.map((row) => tradeItem(row, decisionMap)).filter((item): item is HistoryTradeItem => item !== null);
  const linkedReportIds = new Set(trades.map((trade) => trade.sourceReportId).filter((id): id is string => Boolean(id)));
  const unconvertedDecisions = decisions.filter((decision) => !linkedReportIds.has(decision.id));
  return {
    trades: newestFirst(trades),
    decisions: newestFirst(decisions),
    all: newestFirst<HistoryJournalItem>([...trades, ...unconvertedDecisions]),
  };
}

function isWithinDateRange(occurredAt: string, from?: string, to?: string): boolean {
  const time = Date.parse(occurredAt);
  const fromTime = from ? Date.parse(`${from}T00:00:00.000Z`) : Number.NEGATIVE_INFINITY;
  const toTime = to ? Date.parse(`${to}T23:59:59.999Z`) : Number.POSITIVE_INFINITY;
  return time >= fromTime && time <= toTime;
}

export function filterHistoryJournal(items: HistoryJournalItem[], filters: HistoryJournalFilters): HistoryJournalItem[] {
  const q = filters.q?.trim().toLowerCase() ?? '';
  return items.filter((item) => {
    if (q && ![item.instrument, item.strategyName, item.kind === 'TRADE' ? item.direction : item.verdict].some((value) => value.toLowerCase().includes(q))) return false;
    if (filters.instrument && item.instrument !== filters.instrument) return false;
    if (filters.strategy && item.strategyId !== filters.strategy) return false;
    if (filters.verdict) {
      const verdict = item.kind === 'TRADE' ? item.originalVerdict : item.verdict;
      if (verdict !== filters.verdict) return false;
    }
    if (filters.status && (item.kind !== 'TRADE' || item.status !== filters.status)) return false;
    if (filters.result && (item.kind !== 'TRADE' || item.outcome !== filters.result)) return false;
    return isWithinDateRange(item.occurredAt, filters.from, filters.to);
  });
}

export function summarizeHistoryJournal(trades: HistoryTradeItem[], decisions: HistoryDecisionItem[]) {
  const closed = trades.filter((trade) => trade.status === 'CLOSED');
  const realized = closed.map((trade) => trade.resultR).filter((value): value is number => value !== null);
  return {
    openTrades: trades.filter((trade) => trade.status === 'OPEN').length,
    closedTrades: closed.length,
    savedDecisions: decisions.length,
    realizedR: realized.length ? Number(realized.reduce((sum, value) => sum + value, 0).toFixed(2)) : null,
  };
}
