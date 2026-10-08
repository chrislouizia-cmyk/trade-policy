export type ClosedTradeMetricRow = {
  id?: string | null;
  status?: string | null;
  outcome?: string | null;
  result_r?: number | string | null;
  closed_at?: string | null;
  simulation_mode?: string | null;
  source?: string | null;
  strategy_snapshot?: Record<string, unknown> | null;
};

export type ClosedTradeMetrics = {
  sampleSize: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  netR: number | null;
  averageR: number | null;
  averageWinner: number | null;
  averageLoser: number | null;
  profitFactor: number | null;
  cumulative: Array<{ label: string; value: number }>;
};

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function isAnalyticsSimulationRow(row: ClosedTradeMetricRow | null | undefined): boolean {
  if (!row) return false;
  const snapshot = (row.strategy_snapshot as Record<string, unknown> | null) ?? {};
  const simulationMode = String(
    row.simulation_mode ?? snapshot.simulationMode ?? snapshot.testSource ?? snapshot.internalTestMode ?? ''
  ).trim();
  return row.source === 'SIMULATION' || simulationMode === 'INTERNAL_LIFECYCLE_SMOKE_TEST' || simulationMode === 'SIMULATION';
}

function isRealTradeRow(row: ClosedTradeMetricRow | null | undefined): boolean {
  if (!row) return false;
  if (String(row.status ?? '').toUpperCase() !== 'CLOSED') return false;
  if (!row.closed_at) return false;
  if (isAnalyticsSimulationRow(row)) return false;
  return true;
}

export function summarizeClosedTradeMetrics(rows: Array<ClosedTradeMetricRow | null | undefined>): ClosedTradeMetrics {
  const canonical = (rows ?? []).filter((row): row is ClosedTradeMetricRow => isRealTradeRow(row));
  const sampleSize = canonical.length;

  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      wins: 0,
      losses: 0,
      breakeven: 0,
      winRate: null,
      netR: null,
      averageR: null,
      averageWinner: null,
      averageLoser: null,
      profitFactor: null,
      cumulative: [],
    };
  }

  const realized = canonical
    .map((row) => toFiniteNumber(row.result_r))
    .filter((value): value is number => value !== null);

  const wins = canonical.filter((row) => String(row.outcome ?? '').toUpperCase() === 'WIN').length;
  const losses = canonical.filter((row) => String(row.outcome ?? '').toUpperCase() === 'LOSS').length;
  const breakeven = canonical.filter((row) => String(row.outcome ?? '').toUpperCase() === 'BREAKEVEN').length;

  const netR = realized.reduce((sum, value) => sum + value, 0);
  const averageR = realized.reduce((sum, value) => sum + value, 0) / realized.length;
  const winnerR = realized.filter((value) => value > 0);
  const loserR = realized.filter((value) => value < 0).map((value) => Math.abs(value));
  const averageWinner = winnerR.length > 0 ? winnerR.reduce((sum, value) => sum + value, 0) / winnerR.length : null;
  const averageLoser = loserR.length > 0 ? loserR.reduce((sum, value) => sum + value, 0) / loserR.length : null;

  const grossPositive = winnerR.reduce((sum, value) => sum + value, 0);
  const grossNegative = loserR.reduce((sum, value) => sum + value, 0);
  const profitFactor = grossNegative > 0 ? grossPositive / grossNegative : null;

  return {
    sampleSize,
    wins,
    losses,
    breakeven,
    winRate: (wins / sampleSize) * 100,
    netR,
    averageR,
    averageWinner,
    averageLoser,
    profitFactor,
    cumulative: buildCumulativeRSeries(canonical),
  };
}

export function buildCumulativeRSeries(rows: Array<ClosedTradeMetricRow | null | undefined>): Array<{ label: string; value: number }> {
  const canonical = (rows ?? [])
    .filter((row): row is ClosedTradeMetricRow => isRealTradeRow(row))
    .sort((a, b) => new Date(a.closed_at ?? 0).getTime() - new Date(b.closed_at ?? 0).getTime());
  let running = 0;

  return canonical.map((row) => {
    const value = toFiniteNumber(row.result_r) ?? 0;
    running += value;
    return { label: String(row.closed_at ?? ''), value: Number(running.toFixed(8)) };
  });
}
