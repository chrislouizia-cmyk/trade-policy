'use client';

import { useMemo } from 'react';
import { summarizeClosedTradeMetrics } from '@/lib/analytics/closed-trade-metrics';

type Trade = {
  id: string;
  resultR: number | null;
  realizedPnl: number | null;
  outcome: string;
  closedAt: string;
  instrument: string;
  strategy: string;
  direction: string;
  activationMode: string;
  tookAgainstVerdict: boolean;
  sourceReportId: string | null;
};

type Account = {
  name: string;
  currency: string;
  startingBalance: number;
  currentBalance: number;
};

type BreakdownEntry = {
  name: string;
  trades: number;
  winRate: number;
  averageR: number;
};

export default function AnalyticsDashboard({ account, trades }: { account: Account; trades: Trade[] }) {
  const metricRows = useMemo(() => trades.map((trade) => ({
    id: trade.id,
    status: 'CLOSED',
    closed_at: trade.closedAt,
    outcome: trade.outcome,
    result_r: trade.resultR,
  })), [trades]);
  const metrics = useMemo(() => summarizeClosedTradeMetrics(metricRows), [metricRows]);
  const ordered = useMemo(
    () => [...trades].sort((a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()),
    [trades]
  );

  if (trades.length === 0) {
    return (
      <div className="stack analytics-shell">
        <section className="card analytics-hero">
          <div>
            <span className="eyebrow">YOUR EVIDENCE BASE</span>
            <h1>No closed trades yet</h1>
            <p className="muted">Analytics becomes meaningful after a trade closes with a real outcome.</p>
          </div>
        </section>
        <section className="card analytics-empty-state">
          <h2>Build a reliable performance sample</h2>
          <p>Once a trade closes with a real outcome, Analytics will show performance based only on canonical closed-trade data.</p>
          <div className="button-row">
            <a className="button-link primary" href="/validate">Review a live decision</a>
            <a className="button-link secondary" href="/history">Review decision history</a>
          </div>
        </section>
      </div>
    );
  }

  const strategyBreakdown = buildBreakdown(ordered, 'strategy');
  const instrumentBreakdown = buildBreakdown(ordered, 'instrument');
  const directionBreakdown = buildBreakdown(ordered, 'direction');
  const activationBreakdown = buildBreakdown(ordered, (trade) =>
    trade.activationMode === 'OVERRIDE' || trade.tookAgainstVerdict ? 'OVERRIDE' : 'READY'
  );

  const composition = [
    { label: 'Wins', value: metrics.wins, color: 'var(--green, #22c55e)' },
    { label: 'Losses', value: metrics.losses, color: 'var(--red, #ef4444)' },
    { label: 'Breakeven', value: metrics.breakeven, color: 'var(--muted, #94a3b8)' },
  ];

  return (
    <div className="stack analytics-shell">
      <section className="card analytics-hero">
        <div>
          <span className="eyebrow">REAL CLOSED-TRADE DATA</span>
          <h1>How am I performing?</h1>
          <p className="muted">Metrics only count canonical closed trades. Internal simulation records never appear here.</p>
        </div>
        <div className="analytics-hero-meta">
          <span>{metrics.sampleSize} closed trades</span>
          <small>Source: active_trades.status = CLOSED</small>
        </div>
      </section>

      <section className="analytics-metric-grid" aria-label="Analytics metrics">
        <Metric label="Closed trades" value={String(metrics.sampleSize)} sub="Real closed trades only" />
        <Metric label="Win rate" value={metrics.winRate === null ? 'Not enough data' : `${metrics.winRate.toFixed(1)}%`} sub={`${metrics.wins} wins · ${metrics.losses} losses · ${metrics.breakeven} breakeven`} />
        <Metric label="Net R" value={metrics.netR === null ? 'Not enough data' : `${metrics.netR.toFixed(2)}R`} sub="Canonical realized R" />
        <Metric label="Average R" value={metrics.averageR === null ? 'Not enough data' : `${metrics.averageR.toFixed(2)}R`} sub="Per closed trade" />
        <Metric label="Average winner" value={metrics.averageWinner === null ? 'Not enough data' : `${metrics.averageWinner.toFixed(2)}R`} />
        <Metric label="Average loser" value={metrics.averageLoser === null ? 'Not enough data' : `${metrics.averageLoser.toFixed(2)}R`} />
        <Metric label="Profit factor" value={metrics.profitFactor === null ? 'Not enough data' : metrics.profitFactor.toFixed(2)} sub="Gross positive R ÷ gross negative R" />
      </section>

      <section className="card analytics-chart-card">
        <div className="section-title analytics-section-title">
          <div>
            <span className="eyebrow">REALIZED R</span>
            <h2>Cumulative realized R</h2>
          </div>
          <p className="muted">A rolling sum of canonical closed-trade R values in chronological order.</p>
        </div>
        {metrics.cumulative.length === 0 ? (
          <div className="analytics-empty-inline">No realized R is available yet.</div>
        ) : (
          <svg viewBox="0 0 100 100" className="analytics-cumulative-chart" preserveAspectRatio="none" role="img" aria-label="Cumulative realized R chart">
            <line x1="0" y1="92" x2="100" y2="92" />
            <polyline points={buildLinePoints(metrics.cumulative)} />
          </svg>
        )}
      </section>

      <div className="analytics-two-up-grid">
        <section className="card analytics-composition-card">
          <div className="section-title analytics-section-title">
            <div>
              <span className="eyebrow">OUTCOMES</span>
              <h2>Win / loss / breakeven</h2>
            </div>
          </div>
          <div className="analytics-bar-stack">
            {composition.map((item) => (
              <div key={item.label} className="analytics-bar-row">
                <div className="analytics-bar-meta">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
                <div className="analytics-bar-track">
                  <span style={{ width: `${metrics.sampleSize ? (item.value / metrics.sampleSize) * 100 : 0}%`, background: item.color }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card analytics-breakdown-card">
          <div className="section-title analytics-section-title">
            <div>
              <span className="eyebrow">DISCIPLINE</span>
              <h2>Activation mode</h2>
            </div>
          </div>
          <div className="analytics-breakdown-list">
            {activationBreakdown.map((entry) => (
              <div key={entry.name} className="analytics-breakdown-row">
                <div>
                  <strong>{entry.name}</strong>
                  <small>{entry.trades} trades</small>
                </div>
                <div className="analytics-breakdown-metrics">
                  <span>{entry.winRate.toFixed(1)}% win</span>
                  <span>{entry.averageR.toFixed(2)}R avg</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="analytics-two-up-grid">
        <section className="card analytics-breakdown-card">
          <div className="section-title analytics-section-title">
            <div>
              <span className="eyebrow">STRATEGY</span>
              <h2>Performance by strategy</h2>
            </div>
          </div>
          <div className="analytics-breakdown-list">
            {strategyBreakdown.map((entry) => (
              <div key={entry.name} className="analytics-breakdown-row">
                <div>
                  <strong>{entry.name}</strong>
                  <small>{entry.trades} trades</small>
                </div>
                <div className="analytics-breakdown-metrics">
                  <span>{entry.winRate.toFixed(1)}% win</span>
                  <span>{entry.averageR.toFixed(2)}R avg</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card analytics-breakdown-card">
          <div className="section-title analytics-section-title">
            <div>
              <span className="eyebrow">INSTRUMENT</span>
              <h2>Performance by instrument</h2>
            </div>
          </div>
          <div className="analytics-breakdown-list">
            {instrumentBreakdown.map((entry) => (
              <div key={entry.name} className="analytics-breakdown-row">
                <div>
                  <strong>{entry.name}</strong>
                  <small>{entry.trades} trades</small>
                </div>
                <div className="analytics-breakdown-metrics">
                  <span>{entry.winRate.toFixed(1)}% win</span>
                  <span>{entry.averageR.toFixed(2)}R avg</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="analytics-two-up-grid analytics-bottom-grid">
        <section className="card analytics-breakdown-card">
          <div className="section-title analytics-section-title">
            <div>
              <span className="eyebrow">DIRECTION</span>
              <h2>LONG vs SHORT</h2>
            </div>
          </div>
          <div className="analytics-breakdown-list">
            {directionBreakdown.map((entry) => (
              <div key={entry.name} className="analytics-breakdown-row">
                <div>
                  <strong>{entry.name}</strong>
                  <small>{entry.trades} trades</small>
                </div>
                <div className="analytics-breakdown-metrics">
                  <span>{entry.winRate.toFixed(1)}% win</span>
                  <span>{entry.averageR.toFixed(2)}R avg</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card analytics-review-card">
          <div className="section-title analytics-section-title">
            <div>
              <span className="eyebrow">RECENT CLOSED TRADES</span>
              <h2>Review the last outcomes</h2>
            </div>
          </div>
          <div className="analytics-trade-table">
            {ordered.slice(-8).reverse().map((trade) => (
              <div key={trade.id} className="analytics-trade-row">
                <div>
                  <strong>{trade.instrument}</strong>
                  <small>{new Date(trade.closedAt).toLocaleString()}</small>
                </div>
                <div>
                  <strong>{trade.direction}</strong>
                  <small>{trade.strategy}</small>
                </div>
                <div>
                  <strong>{trade.outcome}</strong>
                  <small>{trade.activationMode}</small>
                </div>
                <div>
                  <strong>{trade.resultR === null ? 'No R' : `${trade.resultR.toFixed(2)}R`}</strong>
                  {trade.sourceReportId ? <a href={`/history/${trade.sourceReportId}`}>Open report</a> : <span className="muted">No report link</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card analytics-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function buildBreakdown(rows: Trade[], key: string | ((trade: Trade) => string)): BreakdownEntry[] {
  const buckets = new Map<string, Trade[]>();

  for (const trade of rows) {
    const bucketName = typeof key === 'function' ? key(trade) : String((trade as Record<string, unknown>)[key] ?? 'Unknown');
    const current = buckets.get(bucketName) ?? [];
    current.push(trade);
    buckets.set(bucketName, current);
  }

  return Array.from(buckets.entries())
    .map(([name, items]) => {
      const values = items
        .map((item) => item.resultR)
        .filter((value): value is number => value !== null && Number.isFinite(value));
      const wins = items.filter((item) => String(item.outcome ?? '').toUpperCase() === 'WIN').length;
      return {
        name,
        trades: items.length,
        winRate: items.length ? (wins / items.length) * 100 : 0,
        averageR: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
      };
    })
    .sort((a, b) => b.trades - a.trades || b.averageR - a.averageR);
}

function buildLinePoints(points: Array<{ label: string; value: number }>) {
  if (points.length === 0) return '';
  const values = points.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;

  return points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 100;
      const y = 92 - ((point.value - min) / span) * 80;
      return `${x},${y}`;
    })
    .join(' ');
}
