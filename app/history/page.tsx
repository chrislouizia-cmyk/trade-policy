import { redirect } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import {
  buildHistoryJournal,
  filterHistoryJournal,
  summarizeHistoryJournal,
  type HistoryDecisionItem,
  type HistoryDecisionRow,
  type HistoryJournalItem,
  type HistoryTradeItem,
  type HistoryTradeRow,
} from '@/lib/history-journal';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Search = {
  view?: string;
  q?: string;
  verdict?: string;
  instrument?: string;
  strategy?: string;
  status?: string;
  result?: string;
  from?: string;
  to?: string;
};

const views = ['all', 'trades', 'decisions'] as const;
const verdicts = ['READY', 'WAIT', 'BLOCKED', 'NO_SETUP', 'MARKET_CLOSED', 'DATA_UNAVAILABLE', 'STRATEGY_INCOMPLETE', 'REJECTED'] as const;

function label(value: string | null | undefined, fallback = 'Not available') {
  return value ? value.replaceAll('_', ' ') : fallback;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatPrice(value: number) {
  return Number(value.toFixed(5)).toLocaleString();
}

function formatR(value: number | null) {
  if (value === null) return 'Not recorded';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`;
}

function toneForVerdict(verdict: string | null) {
  if (verdict === 'READY') return 'positive';
  if (['BLOCKED', 'STRATEGY_INCOMPLETE', 'REJECTED'].includes(String(verdict))) return 'danger';
  return 'warning';
}

function tabHref(view: (typeof views)[number]) {
  return view === 'all' ? '/history' : `/history?view=${view}`;
}

function TradeJournalRow({ item }: { item: HistoryTradeItem }) {
  const resultValue = item.status === 'CLOSED' ? item.resultR : item.currentR;
  return (
    <article className="history-row history-journal-row trade-journal-row">
      <div className={`history-timeline-marker ${item.status === 'OPEN' ? 'open' : 'closed'}`} aria-hidden="true"><span /></div>
      <div className="history-row-main history-event-main">
        <div className="history-row-head">
          <div className="history-row-tags">
            <span className="history-kind-tag">TRADE</span>
            <strong>{item.instrument}</strong>
            <span className="history-direction-label">{item.direction}</span>
          </div>
          <div className="history-row-badges">
            {item.takenAgainstVerdict ? <span className="history-badge tone-danger">OVERRIDE</span> : null}
            <span className={`history-badge tone-${item.status === 'OPEN' ? 'positive' : item.outcome === 'LOSS' ? 'danger' : 'neutral'}`}>{item.status}</span>
          </div>
        </div>
        <div className="history-event-time"><time dateTime={item.openedAt}>Opened {formatDateTime(item.openedAt)}</time>{item.closedAt ? <time dateTime={item.closedAt}>Closed {formatDateTime(item.closedAt)}</time> : null}</div>
        <h3>{item.strategyName}<span>{item.setupType ?? 'Setup not recorded'}</span></h3>
        <p>{item.originalVerdictReason ?? (item.status === 'OPEN' ? 'Trade is currently under active supervision.' : 'This trade has completed its lifecycle.')}</p>
        <details className="history-event-details">
          <summary>Trade details <span>Entry, risk and lifecycle context</span></summary>
          <div className="history-event-detail-grid">
            <div><span>Entry</span><strong>{formatPrice(item.entry)}</strong></div>
            <div><span>Stop</span><strong>{formatPrice(item.stopLoss)}</strong></div>
            <div><span>Target</span><strong>{formatPrice(item.takeProfit)}</strong></div>
            <div><span>Original verdict</span><strong>{label(item.originalVerdict)}</strong></div>
            <div><span>Initial R:R</span><strong>{item.initialRR === null ? 'Not recorded' : `${item.initialRR.toFixed(2)}R`}</strong></div>
            <div><span>Risk</span><strong>{item.riskPercent === null ? 'Not recorded' : `${item.riskPercent.toFixed(2)}%`}</strong></div>
          </div>
        </details>
      </div>

      <aside className="history-event-outcome">
        <span>{item.status === 'OPEN' ? 'Current R' : 'Realized R'}</span>
        <strong className={resultValue !== null && resultValue < 0 ? 'metric-negative' : 'metric-positive'}>{formatR(resultValue)}</strong>
        <small>{item.status === 'OPEN' ? 'In progress' : label(item.outcome)}</small>
      </aside>

      <div className="history-row-action history-journal-actions history-event-actions">
        {item.sourceReportId ? <a href={`/history/${item.sourceReportId}`} className="button-link secondary">Open decision</a> : null}
        {item.status === 'OPEN' ? <a href="/active-trade" className="button-link primary">Manage trade</a> : null}
        {item.status === 'CLOSED' && !item.sourceReportId ? <a href="/analytics" className="button-link secondary">View analytics</a> : null}
      </div>
    </article>
  );
}

function DecisionJournalRow({ item }: { item: HistoryDecisionItem }) {
  return (
    <article className="history-row history-journal-row decision-journal-row">
      <div className="history-timeline-marker decision" aria-hidden="true"><span /></div>
      <div className="history-row-main history-event-main">
        <div className="history-row-head">
          <div className="history-row-tags">
            <span className="history-kind-tag">DECISION</span>
            <strong>{item.instrument}</strong>
            <span className="history-direction-label">{item.timeframe}</span>
          </div>
          <span className={`history-badge tone-${toneForVerdict(item.verdict)}`}>{label(item.verdict)}</span>
        </div>
        <time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt)}</time>
        <h3>{item.strategyName}<span>Saved market decision</span></h3>
        <p>{item.primaryReason}</p>
        <div className="history-decision-facts">
          <span>Readiness <strong>{item.readinessPercent === null ? '—' : `${Math.round(item.readinessPercent)}%`}</strong></span>
          <span>Freshness <strong>{label(item.freshness)}</strong></span>
          {item.provider ? <span>Provider <strong>{item.provider}</strong></span> : null}
        </div>
      </div>
      <div className="history-row-action history-event-actions"><a href={`/history/${item.id}`} className="button-link secondary">Open report</a></div>
    </article>
  );
}

function JournalRow({ item }: { item: HistoryJournalItem }) {
  return item.kind === 'TRADE' ? <TradeJournalRow item={item} /> : <DecisionJournalRow item={item} />;
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const filters = await searchParams;
  const selectedView = views.includes(filters.view as (typeof views)[number]) ? filters.view as (typeof views)[number] : 'all';
  const s = await createClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect('/client/login?next=/history');

  const displayName = await getUserDisplayName(s, user);
  const [tradeResult, decisionResult] = await Promise.all([
    s.from('active_trades')
      .select('id,trade_record_id,instrument,direction,entry,stop_loss,take_profit,risk_percent,initial_rr,setup_type,status,current_r,taken_against_verdict,original_verdict,original_verdict_reason,override_reason,close_price,result_r,outcome,opened_at,closed_at,strategy_profile_id,strategy_name_at_entry,strategy_snapshot,strategy_revision_id,source_report_id,activation_mode')
      .eq('user_id', user.id)
      .order('opened_at', { ascending: false })
      .limit(100),
    s.from('decision_reports')
      .select('id,created_at,instrument,timeframe,strategy_id,strategy_name,verdict,primary_reason,data_freshness,market_provider,readiness_percent,snapshot_json')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const journal = buildHistoryJournal((tradeResult.data ?? []) as HistoryTradeRow[], (decisionResult.data ?? []) as HistoryDecisionRow[]);
  const summary = summarizeHistoryJournal(journal.trades, journal.decisions);
  const selectedItems = selectedView === 'trades' ? journal.trades : selectedView === 'decisions' ? journal.decisions : journal.all;
  const visibleItems = filterHistoryJournal(selectedItems, filters);
  const loadError = tradeResult.error ?? decisionResult.error;
  if (loadError) {
    console.error('History journal load failed', {
      tradeError: tradeResult.error?.message ?? null,
      decisionError: decisionResult.error?.message ?? null,
    });
  }
  const instruments = [...new Set([...journal.trades, ...journal.decisions].map((item) => item.instrument))].sort();
  const strategies = [...new Map([...journal.trades, ...journal.decisions].filter((item) => item.strategyId).map((item) => [item.strategyId as string, item.strategyName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const hasFilters = Boolean(filters.q || filters.verdict || filters.instrument || filters.strategy || filters.status || filters.result || filters.from || filters.to);
  const clearHref = tabHref(selectedView);

  return (
    <main className="container history-page-shell">
      <AppHeader eyebrow="TRADE POLICE / HISTORY" displayName={displayName} description="Review past decisions and outcomes as one chronological journal." userId={user.id} />

      <section className="card history-overview-card history-journal-hero">
        <header className="history-header-row">
          <div><p className="eyebrow">TRADING JOURNAL</p><h1>Your decisions, in context.</h1><p className="muted">Trace every market read from evidence to execution and outcome—without rewriting what you knew at the time.</p></div>
          <a className="button-link secondary" href="/validate">Open decision workspace</a>
        </header>
        <div className="history-summary-grid history-pulse-strip">
          <div className="history-summary-box"><span>Open trades</span><strong>{summary.openTrades}</strong></div>
          <div className="history-summary-box"><span>Closed trades</span><strong>{summary.closedTrades}</strong></div>
          <div className="history-summary-box"><span>Saved decisions</span><strong>{summary.savedDecisions}</strong></div>
          <div className="history-summary-box history-realized-pulse"><span>Realized R</span><strong className={(summary.realizedR ?? 0) >= 0 ? 'metric-positive' : 'metric-negative'}>{summary.realizedR === null ? '—' : formatR(summary.realizedR)}</strong></div>
        </div>
      </section>

      <section className="history-list-card history-journal-surface">
        <header className="history-list-header">
          <div><p className="eyebrow">RECORDED ACTIVITY</p><h2>Journal timeline</h2><p className="muted">{visibleItems.length} {visibleItems.length === 1 ? 'event' : 'events'} in this view</p></div>
          <p className="history-integrity-note"><span aria-hidden="true">✓</span> Historical snapshots are never recalculated. SIMULATION / INTERNAL TEST records are excluded.</p>
        </header>

        <nav className="history-view-tabs" aria-label="History record type">
          <a href="/history" aria-current={selectedView === 'all' ? 'page' : undefined}>All activity <span>{journal.all.length}</span></a>
          <a href="/history?view=trades" aria-current={selectedView === 'trades' ? 'page' : undefined}>Trades <span>{journal.trades.length}</span></a>
          <a href="/history?view=decisions" aria-current={selectedView === 'decisions' ? 'page' : undefined}>Decisions <span>{journal.decisions.length}</span></a>
        </nav>

        <details className="history-filter-disclosure" open={hasFilters}>
          <summary><span>Filter journal</span><small>{hasFilters ? 'Filters active' : 'Search, dates and record attributes'}</small></summary>
          <form className="history-filter-bar history-journal-filters" method="get">
            {selectedView !== 'all' ? <input type="hidden" name="view" value={selectedView} /> : null}
            <label className="history-search-field"><span>Search</span><input name="q" defaultValue={filters.q ?? ''} placeholder="Instrument or strategy" /></label>
            <label><span>Verdict</span><select name="verdict" defaultValue={filters.verdict ?? ''}><option value="">All verdicts</option>{verdicts.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
            <label><span>Status</span><select name="status" defaultValue={filters.status ?? ''}><option value="">All statuses</option><option value="OPEN">Open</option><option value="CLOSED">Closed</option></select></label>
            <label><span>Result</span><select name="result" defaultValue={filters.result ?? ''}><option value="">All results</option><option value="WIN">Win</option><option value="LOSS">Loss</option><option value="BREAKEVEN">Breakeven</option><option value="PARTIAL">Partial</option></select></label>
            <label><span>Instrument</span><select name="instrument" defaultValue={filters.instrument ?? ''}><option value="">All instruments</option>{instruments.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>Strategy</span><select name="strategy" defaultValue={filters.strategy ?? ''}><option value="">All strategies</option>{strategies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label><span>From</span><input type="date" name="from" defaultValue={filters.from ?? ''} /></label>
            <label><span>To</span><input type="date" name="to" defaultValue={filters.to ?? ''} /></label>
            <div className="history-filter-actions"><button type="submit" className="primary">Apply filters</button><a className="button-link secondary" href={clearHref}>Clear</a></div>
          </form>
        </details>

        {loadError ? (
          <div className="history-empty-state error-state"><h3>History could not be loaded</h3><p>The recorded journal is temporarily unavailable. Please try again.</p></div>
        ) : visibleItems.length === 0 ? (
          <div className="history-empty-state empty-state">
            <h3>{hasFilters ? 'No activity matches these filters' : 'No recorded activity yet'}</h3>
            <p>{hasFilters ? 'Clear or adjust the filters to review other journal entries.' : 'Saved decisions and executed trades will appear here with their original timestamps and context.'}</p>
            {hasFilters ? <a className="button-link secondary" href={clearHref}>Clear filters</a> : <a className="button-link primary" href="/validate">Review a live decision</a>}
          </div>
        ) : <div className="history-row-list">{visibleItems.map((item) => <JournalRow key={`${item.kind}:${item.id}`} item={item} />)}</div>}
      </section>
    </main>
  );
}
