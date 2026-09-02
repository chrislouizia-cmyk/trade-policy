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
import { getRequestLocale } from '@/lib/i18n/server';
import { getScreenCopy, type ScreenCopy } from '@/lib/i18n/screen-copy';
import type { Locale } from '@/lib/i18n/config';

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

function formatDateTime(value: string, locale: Locale) {
  return new Date(value).toLocaleString(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatPrice(value: number) {
  return Number(value.toFixed(5)).toLocaleString();
}

function formatR(value: number | null, notRecorded = 'Not recorded') {
  if (value === null) return notRecorded;
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

function TradeJournalRow({ item, c, locale }: { item: HistoryTradeItem; c: ScreenCopy['history']; locale: Locale }) {
  const resultValue = item.status === 'CLOSED' ? item.resultR : item.currentR;
  return (
    <article className="history-row history-journal-row trade-journal-row">
      <div className={`history-timeline-marker ${item.status === 'OPEN' ? 'open' : 'closed'}`} aria-hidden="true"><span /></div>
      <div className="history-row-main history-event-main">
        <div className="history-row-head">
          <div className="history-row-tags">
            <span className="history-kind-tag">{c.trade}</span>
            <strong>{item.instrument}</strong>
            <span className="history-direction-label">{item.direction}</span>
          </div>
          <div className="history-row-badges">
            {item.takenAgainstVerdict ? <span className="history-badge tone-danger">{c.override}</span> : null}
            <span className={`history-badge tone-${item.status === 'OPEN' ? 'positive' : item.outcome === 'LOSS' ? 'danger' : 'neutral'}`}>{item.status}</span>
          </div>
        </div>
        <div className="history-event-time"><time dateTime={item.openedAt}>{c.opened} {formatDateTime(item.openedAt, locale)}</time>{item.closedAt ? <time dateTime={item.closedAt}>{c.closedAt} {formatDateTime(item.closedAt, locale)}</time> : null}</div>
        <h3>{item.strategyName}<span>{item.setupType ?? c.setupMissing}</span></h3>
        <p>{item.originalVerdictReason ?? (item.status === 'OPEN' ? c.activeSupervision : c.completedLifecycle)}</p>
        <details className="history-event-details">
          <summary>{c.tradeDetails} <span>{c.tradeDetailsHint}</span></summary>
          <div className="history-event-detail-grid">
            <div><span>{c.entry}</span><strong>{formatPrice(item.entry)}</strong></div>
            <div><span>{c.stop}</span><strong>{formatPrice(item.stopLoss)}</strong></div>
            <div><span>{c.target}</span><strong>{formatPrice(item.takeProfit)}</strong></div>
            <div><span>{c.originalVerdict}</span><strong>{label(item.originalVerdict, c.notAvailable)}</strong></div>
            <div><span>{c.initialRR}</span><strong>{item.initialRR === null ? c.notRecorded : `${item.initialRR.toFixed(2)}R`}</strong></div>
            <div><span>{c.risk}</span><strong>{item.riskPercent === null ? c.notRecorded : `${item.riskPercent.toFixed(2)}%`}</strong></div>
          </div>
        </details>
      </div>

      <aside className="history-event-outcome">
        <span>{item.status === 'OPEN' ? c.currentR : c.realizedR}</span>
        <strong className={resultValue !== null && resultValue < 0 ? 'metric-negative' : 'metric-positive'}>{formatR(resultValue, c.notRecorded)}</strong>
        <small>{item.status === 'OPEN' ? c.inProgress : label(item.outcome, c.notAvailable)}</small>
      </aside>

      <div className="history-row-action history-journal-actions history-event-actions">
        {item.sourceReportId ? <a href={`/history/${item.sourceReportId}`} className="button-link secondary">{c.openDecision}</a> : null}
        {item.status === 'OPEN' ? <a href="/active-trade" className="button-link primary">{c.manageTrade}</a> : null}
        {item.status === 'CLOSED' && !item.sourceReportId ? <a href="/analytics" className="button-link secondary">{c.viewAnalytics}</a> : null}
      </div>
    </article>
  );
}

function DecisionJournalRow({ item, c, locale }: { item: HistoryDecisionItem; c: ScreenCopy['history']; locale: Locale }) {
  return (
    <article className="history-row history-journal-row decision-journal-row">
      <div className="history-timeline-marker decision" aria-hidden="true"><span /></div>
      <div className="history-row-main history-event-main">
        <div className="history-row-head">
          <div className="history-row-tags">
            <span className="history-kind-tag">{c.decision}</span>
            <strong>{item.instrument}</strong>
            <span className="history-direction-label">{item.timeframe}</span>
          </div>
          <span className={`history-badge tone-${toneForVerdict(item.verdict)}`}>{label(item.verdict)}</span>
        </div>
        <time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt, locale)}</time>
        <h3>{item.strategyName}<span>{c.savedMarketDecision}</span></h3>
        <p>{item.primaryReason}</p>
        <div className="history-decision-facts">
          <span>{c.readiness} <strong>{item.readinessPercent === null ? '—' : `${Math.round(item.readinessPercent)}%`}</strong></span>
          <span>{c.freshness} <strong>{label(item.freshness, c.notAvailable)}</strong></span>
          {item.provider ? <span>{c.provider} <strong>{item.provider}</strong></span> : null}
        </div>
      </div>
      <div className="history-row-action history-event-actions"><a href={`/history/${item.id}`} className="button-link secondary">{c.openReport}</a></div>
    </article>
  );
}

function JournalRow({ item, c, locale }: { item: HistoryJournalItem; c: ScreenCopy['history']; locale: Locale }) {
  return item.kind === 'TRADE' ? <TradeJournalRow item={item} c={c} locale={locale} /> : <DecisionJournalRow item={item} c={c} locale={locale} />;
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const filters = await searchParams;
  const selectedView = views.includes(filters.view as (typeof views)[number]) ? filters.view as (typeof views)[number] : 'all';
  const s = await createClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect('/client/login?next=/history');

  const [displayName, locale] = await Promise.all([getUserDisplayName(s, user), getRequestLocale()]);
  const c = getScreenCopy(locale).history;
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
      <AppHeader eyebrow={c.eyebrow} displayName={displayName} description={c.description} userId={user.id} />

      <section className="card history-overview-card history-journal-hero">
        <header className="history-header-row">
          <div><p className="eyebrow">{c.journal}</p><h1>{c.title}</h1><p className="muted">{c.intro}</p></div>
          <a className="button-link secondary" href="/validate">{c.openWorkspace}</a>
        </header>
        <div className="history-summary-grid history-pulse-strip">
          <div className="history-summary-box"><span>{c.openTrades}</span><strong>{summary.openTrades}</strong></div>
          <div className="history-summary-box"><span>{c.closedTrades}</span><strong>{summary.closedTrades}</strong></div>
          <div className="history-summary-box"><span>{c.savedDecisions}</span><strong>{summary.savedDecisions}</strong></div>
          <div className="history-summary-box history-realized-pulse"><span>{c.realizedR}</span><strong className={(summary.realizedR ?? 0) >= 0 ? 'metric-positive' : 'metric-negative'}>{summary.realizedR === null ? '—' : formatR(summary.realizedR, c.notRecorded)}</strong></div>
        </div>
      </section>

      <section className="history-list-card history-journal-surface">
        <header className="history-list-header">
          <div><p className="eyebrow">{c.activity}</p><h2>{c.timeline}</h2><p className="muted">{visibleItems.length} {visibleItems.length === 1 ? c.event : c.events} {c.inView}</p></div>
          <p className="history-integrity-note"><span aria-hidden="true">✓</span> {c.integrity}</p>
        </header>

        <nav className="history-view-tabs" aria-label="History record type">
          <a href="/history" aria-current={selectedView === 'all' ? 'page' : undefined}>{c.allActivity} <span>{journal.all.length}</span></a>
          <a href="/history?view=trades" aria-current={selectedView === 'trades' ? 'page' : undefined}>{c.trades} <span>{journal.trades.length}</span></a>
          <a href="/history?view=decisions" aria-current={selectedView === 'decisions' ? 'page' : undefined}>{c.decisions} <span>{journal.decisions.length}</span></a>
        </nav>

        <details className="history-filter-disclosure" open={hasFilters}>
          <summary><span>{c.filter}</span><small>{hasFilters ? c.activeFilters : c.filterHint}</small></summary>
          <form className="history-filter-bar history-journal-filters" method="get">
            {selectedView !== 'all' ? <input type="hidden" name="view" value={selectedView} /> : null}
            <label className="history-search-field"><span>{c.search}</span><input name="q" defaultValue={filters.q ?? ''} placeholder={c.searchPlaceholder} /></label>
            <label><span>{c.verdict}</span><select name="verdict" defaultValue={filters.verdict ?? ''}><option value="">{c.allVerdicts}</option>{verdicts.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
            <label><span>{c.status}</span><select name="status" defaultValue={filters.status ?? ''}><option value="">{c.allStatuses}</option><option value="OPEN">{c.open}</option><option value="CLOSED">{c.closed}</option></select></label>
            <label><span>{c.result}</span><select name="result" defaultValue={filters.result ?? ''}><option value="">{c.allResults}</option><option value="WIN">{c.win}</option><option value="LOSS">{c.loss}</option><option value="BREAKEVEN">{c.breakeven}</option><option value="PARTIAL">{c.partial}</option></select></label>
            <label><span>{c.instrument}</span><select name="instrument" defaultValue={filters.instrument ?? ''}><option value="">{c.allInstruments}</option>{instruments.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>{c.strategy}</span><select name="strategy" defaultValue={filters.strategy ?? ''}><option value="">{c.allStrategies}</option>{strategies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label><span>{c.from}</span><input type="date" name="from" defaultValue={filters.from ?? ''} /></label>
            <label><span>{c.to}</span><input type="date" name="to" defaultValue={filters.to ?? ''} /></label>
            <div className="history-filter-actions"><button type="submit" className="primary">{c.apply}</button><a className="button-link secondary" href={clearHref}>{c.clear}</a></div>
          </form>
        </details>

        {loadError ? (
          <div className="history-empty-state error-state"><h3>{c.loadFailed}</h3><p>{c.loadFailedBody}</p></div>
        ) : visibleItems.length === 0 ? (
          <div className="history-empty-state empty-state">
            <h3>{hasFilters ? c.noMatches : c.noActivity}</h3>
            <p>{hasFilters ? c.noMatchesBody : c.noActivityBody}</p>
            {hasFilters ? <a className="button-link secondary" href={clearHref}>{c.clearFilters}</a> : <a className="button-link primary" href="/validate">{c.reviewLive}</a>}
          </div>
        ) : <div className="history-row-list">{visibleItems.map((item) => <JournalRow key={`${item.kind}:${item.id}`} item={item} c={c} locale={locale} />)}</div>}
      </section>
    </main>
  );
}
