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

type Account = { name: string; currency: string; startingBalance: number; currentBalance: number };
type BreakdownEntry = { name: string; trades: number; winRate: number; averageR: number };

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
    [trades],
  );

  if (trades.length === 0) {
    return (
      <div className="stack analytics-shell analytics-premium-shell">
        <section className="card analytics-empty-state analytics-premium-empty">
          <div className="analytics-empty-orbit" aria-hidden="true"><span>R</span></div>
          <div>
            <span className="eyebrow">PERFORMANCE COCKPIT</span>
            <h1>Your edge starts with evidence.</h1>
            <p>No closed trades yet. Analytics becomes meaningful after a trade closes with a real outcome.</p>
            <div className="button-row">
              <a className="button-link primary" href="/validate">Review a live decision</a>
              <a className="button-link secondary" href="/history">Open trading journal</a>
            </div>
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
  const netR = metrics.netR ?? 0;
  const netTone = netR > 0 ? 'positive' : netR < 0 ? 'negative' : 'neutral';
  const chart = buildChart(metrics.cumulative);
  const totalOutcomes = Math.max(1, metrics.sampleSize);
  const fullCircle = 100;
  const winStop = (metrics.wins / totalOutcomes) * 100;
  const lossStop = winStop + (metrics.losses / totalOutcomes) * 100;
  const outcomeChart = {
    background: `conic-gradient(var(--green) 0 ${winStop}%, var(--red) ${winStop}% ${lossStop}%, #7f8ca3 ${lossStop}% ${fullCircle}%)`,
  };

  return (
    <div className="stack analytics-shell analytics-premium-shell">
      <section className="card analytics-hero analytics-cockpit-hero">
        <div className="analytics-hero-copy">
          <div className="analytics-kicker-row">
            <span className="eyebrow">PERFORMANCE COCKPIT</span>
            <span className={`analytics-sample-badge ${metrics.sampleSize < 20 ? 'early' : ''}`}>{metrics.sampleSize < 20 ? 'Early sample' : 'Established sample'}</span>
          </div>
          <h1>Your edge, measured.</h1>
          <p>See what is working, where discipline slips, and which patterns deserve more capital.</p>
          <small>Metrics only count canonical closed trades · Internal simulations excluded</small>
        </div>
        <div className={`analytics-hero-score ${netTone}`}>
          <span>Net realized R</span>
          <strong>{metrics.netR === null ? '—' : `${metrics.netR >= 0 ? '+' : ''}${metrics.netR.toFixed(2)}R`}</strong>
          <div><b>{metrics.sampleSize}</b> closed trades <i aria-hidden="true" /> <b>{metrics.winRate === null ? '—' : `${metrics.winRate.toFixed(0)}%`}</b> win rate</div>
          <small>Source: active_trades.status = CLOSED</small>
        </div>
      </section>

      <section className="analytics-primary-metrics" aria-label="Primary analytics metrics">
        <PrimaryMetric label="Win rate" value={metrics.winRate === null ? '—' : `${metrics.winRate.toFixed(1)}%`} sub={`${metrics.wins} wins · ${metrics.losses} losses · ${metrics.breakeven} breakeven`} />
        <PrimaryMetric label="Average R" value={metrics.averageR === null ? '—' : `${signed(metrics.averageR)}R`} sub="Expectancy per closed trade" tone={(metrics.averageR ?? 0) >= 0 ? 'positive' : 'negative'} />
        <PrimaryMetric label="Profit factor" value={metrics.profitFactor === null ? '—' : metrics.profitFactor.toFixed(2)} sub="Gross winning R ÷ losing R" />
      </section>

      <section className="analytics-secondary-strip" aria-label="Supporting analytics metrics">
        <SecondaryMetric label="Closed trades" value={String(metrics.sampleSize)} />
        <SecondaryMetric label="Average winner" value={metrics.averageWinner === null ? '—' : `+${metrics.averageWinner.toFixed(2)}R`} tone="positive" />
        <SecondaryMetric label="Average loser" value={metrics.averageLoser === null ? '—' : `-${metrics.averageLoser.toFixed(2)}R`} tone="negative" />
        <SecondaryMetric label="Account" value={account.name} />
      </section>

      <section className="card analytics-chart-card analytics-equity-card">
        <header className="analytics-panel-heading">
          <div><span className="eyebrow">REALIZED R</span><h2>Performance trajectory</h2></div>
          <div className={`analytics-chart-delta ${netTone}`}><span>Period change</span><strong>{signed(netR)}R</strong></div>
        </header>
        <p className="analytics-panel-note">Cumulative R across canonical closed trades, ordered by close time.</p>
        {metrics.cumulative.length === 0 ? (
          <div className="analytics-empty-inline">No realized R is available yet.</div>
        ) : (
          <div className="analytics-chart-frame">
            <div className="analytics-chart-scale" aria-hidden="true"><span>{chart.max.toFixed(2)}R</span><span>{formatRLabel(0)}</span><span>{chart.min.toFixed(2)}R</span></div>
            <svg viewBox="0 0 100 40" className="analytics-cumulative-chart" preserveAspectRatio="none" role="img" aria-label="Cumulative realized R chart">
              <defs>
                <linearGradient id="realized-r-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={percentage(0)} stopColor="var(--blue)" stopOpacity="0.28" />
                  <stop offset={percentage(fullCircle)} stopColor="var(--blue)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line className="analytics-chart-grid" x1="0" y1={chart.zeroY} x2="100" y2={chart.zeroY} />
              <path className="analytics-chart-area" d={chart.areaPath} />
              <polyline className="analytics-chart-line" points={chart.points} />
            </svg>
            <div className="analytics-chart-axis"><span>{formatShortDate(ordered[0]?.closedAt)}</span><span>{formatShortDate(ordered.at(-1)?.closedAt)}</span></div>
          </div>
        )}
      </section>

      <div className="analytics-insight-grid">
        <section className="card analytics-outcomes-card">
          <header className="analytics-panel-heading"><div><span className="eyebrow">OUTCOMES</span><h2>Result mix</h2></div></header>
          <div className="analytics-outcome-layout">
            <div className="analytics-donut" style={outcomeChart} role="img" aria-label={`${metrics.wins} wins, ${metrics.losses} losses, ${metrics.breakeven} breakeven`}><span><strong>{metrics.sampleSize}</strong>trades</span></div>
            <div className="analytics-outcome-legend">
              <OutcomeRow label="Wins" value={metrics.wins} tone="positive" total={metrics.sampleSize} />
              <OutcomeRow label="Losses" value={metrics.losses} tone="negative" total={metrics.sampleSize} />
              <OutcomeRow label="Breakeven" value={metrics.breakeven} tone="neutral" total={metrics.sampleSize} />
            </div>
          </div>
        </section>
        <BreakdownCard eyebrow="DISCIPLINE" title="Activation mode" entries={activationBreakdown} featured />
      </div>

      <section className="analytics-edge-section">
        <header className="analytics-section-heading">
          <div><span className="eyebrow">EDGE MAP</span><h2>Where performance comes from</h2></div>
          <p>Compare expectancy and win rate across the dimensions that shape your execution.</p>
        </header>
        <div className="analytics-edge-grid">
          <BreakdownCard eyebrow="STRATEGY" title="By playbook" entries={strategyBreakdown} />
          <BreakdownCard eyebrow="INSTRUMENT" title="By market" entries={instrumentBreakdown} />
          <BreakdownCard eyebrow="DIRECTION" title="Long vs short" entries={directionBreakdown} />
        </div>
      </section>

      <section className="card analytics-review-card analytics-recent-card">
        <header className="analytics-panel-heading">
          <div><span className="eyebrow">RECENT CLOSED TRADES</span><h2>Latest outcomes</h2></div>
          <a className="button-link secondary" href="/history?view=trades">Open full journal</a>
        </header>
        <div className="analytics-trade-table" role="table" aria-label="Recent closed trades">
          <div className="analytics-trade-head" role="row"><span>Trade</span><span>Strategy</span><span>Outcome</span><span>Realized</span><span /></div>
          {ordered.slice(-8).reverse().map((trade) => (
            <div key={trade.id} className="analytics-trade-row" role="row">
              <div><strong>{trade.instrument} · {trade.direction}</strong><small>{new Date(trade.closedAt).toLocaleString()}</small></div>
              <div><strong>{trade.strategy}</strong><small>{trade.activationMode}</small></div>
              <div><span className={`analytics-outcome-chip ${outcomeTone(trade.outcome)}`}>{trade.outcome}</span></div>
              <div><strong className={(trade.resultR ?? 0) >= 0 ? 'metric-positive' : 'metric-negative'}>{trade.resultR === null ? 'No R' : `${signed(trade.resultR)}R`}</strong></div>
              <div>{trade.sourceReportId ? <a href={`/history/${trade.sourceReportId}`}>Decision →</a> : <span className="muted">—</span>}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PrimaryMetric({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  return <article className={`card analytics-primary-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{sub}</small></article>;
}

function SecondaryMetric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  return <div className={`analytics-secondary-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function OutcomeRow({ label, value, tone, total }: { label: string; value: number; tone: string; total: number }) {
  return <div className={`analytics-outcome-row ${tone}`}><span><i />{label}</span><strong>{value}<small>{total ? Math.round((value / total) * 100) : 0}%</small></strong></div>;
}

function BreakdownCard({ eyebrow, title, entries, featured = false }: { eyebrow: string; title: string; entries: BreakdownEntry[]; featured?: boolean }) {
  const maxTrades = Math.max(1, ...entries.map((entry) => entry.trades));
  return (
    <section className={`card analytics-breakdown-card analytics-compact-breakdown ${featured ? 'featured' : ''}`}>
      <header className="analytics-panel-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></header>
      <div className="analytics-breakdown-list">
        {entries.map((entry) => (
          <div key={entry.name} className="analytics-breakdown-row">
            <div className="analytics-breakdown-name"><strong>{entry.name}</strong><small>{entry.trades} {entry.trades === 1 ? 'trade' : 'trades'}</small></div>
            <div className="analytics-breakdown-bar" aria-hidden="true"><span style={{ width: `${(entry.trades / maxTrades) * 100}%` }} /></div>
            <div className="analytics-breakdown-metrics"><span>{entry.winRate.toFixed(0)}% win</span><strong className={entry.averageR >= 0 ? 'metric-positive' : 'metric-negative'}>{signed(entry.averageR)}R avg</strong></div>
          </div>
        ))}
      </div>
    </section>
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
  return Array.from(buckets.entries()).map(([name, items]) => {
    const values = items.map((item) => item.resultR).filter((value): value is number => value !== null && Number.isFinite(value));
    const wins = items.filter((item) => String(item.outcome ?? '').toUpperCase() === 'WIN').length;
    return { name, trades: items.length, winRate: items.length ? (wins / items.length) * 100 : 0, averageR: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 };
  }).sort((a, b) => b.trades - a.trades || b.averageR - a.averageR);
}

function buildChart(points: Array<{ label: string; value: number }>) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const zeroY = 36 - ((0 - min) / span) * 30;
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
    const y = 36 - ((point.value - min) / span) * 30;
    return { x, y };
  });
  const linePoints = coordinates.map(({ x, y }) => `${x},${y}`).join(' ');
  const first = coordinates[0] ?? { x: 0, y: zeroY };
  const last = coordinates.at(-1) ?? first;
  const pathPoints = coordinates.map(({ x, y }) => `L ${x} ${y}`).join(' ');
  return { min, max, zeroY, points: linePoints, areaPath: `M ${first.x} ${zeroY} ${pathPoints} L ${last.x} ${zeroY} Z` };
}

function signed(value: number) { return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`; }
function formatRLabel(value: number) { return `${value.toFixed(0)}R`; }
function percentage(value: number) { return `${value}%`; }
function formatShortDate(value: string | undefined) { return value ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''; }
function outcomeTone(outcome: string) {
  const normalized = outcome.toUpperCase();
  if (normalized === 'WIN') return 'positive';
  if (normalized === 'LOSS') return 'negative';
  return 'neutral';
}
