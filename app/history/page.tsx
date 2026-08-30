import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import AppHeader from '@/components/AppHeader';

type Search = { q?: string; verdict?: string; instrument?: string; strategy?: string; from?: string; to?: string };
const verdicts = ['READY', 'WAIT', 'BLOCKED', 'NO_SETUP', 'MARKET_CLOSED', 'DATA_UNAVAILABLE', 'STRATEGY_INCOMPLETE'] as const;
const verdictTone: Record<string, 'positive' | 'neutral' | 'warning' | 'danger'> = {
  READY: 'positive',
  WAIT: 'neutral',
  BLOCKED: 'danger',
  NO_SETUP: 'warning',
  MARKET_CLOSED: 'warning',
  DATA_UNAVAILABLE: 'warning',
  STRATEGY_INCOMPLETE: 'danger',
};

function formatVerdict(value: string | null | undefined) {
  return value ? value.replaceAll('_', ' ') : 'Not available';
}

function isSimulationDecisionReportRow(row: { snapshot_json?: Record<string, unknown> | null } | null | undefined) {
  const snapshot = (row?.snapshot_json as Record<string, unknown> | null) ?? {};
  const simulationMode = String(snapshot.simulationMode ?? snapshot.testSource ?? snapshot.internalTestMode ?? '').trim();
  return simulationMode === 'INTERNAL_LIFECYCLE_SMOKE_TEST' || simulationMode === 'SIMULATION';
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const filters = await searchParams;
  const s = await createClient();
  const { data: { user } } = await s.auth.getUser();

  if (!user) redirect('/client/login?next=/history');

  const displayName = await getUserDisplayName(s, user);

  let query = s
    .from('decision_reports')
    .select('id,created_at,instrument,timeframe,strategy_id,strategy_name,verdict,primary_reason,data_freshness,market_provider,last_verified_candle_at,readiness_percent,snapshot_json')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(100);

  if (filters.q?.trim()) {
    const needle = `%${filters.q.trim()}%`;
    query = query.or(`instrument.ilike.${needle},strategy_name.ilike.${needle}`);
  }
  if (filters.verdict && verdicts.includes(filters.verdict as (typeof verdicts)[number])) {
    query = query.eq('verdict', filters.verdict);
  }
  if (filters.instrument) query = query.eq('instrument', filters.instrument);
  if (filters.strategy) query = query.eq('strategy_id', filters.strategy);
  if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00.000Z`);
  if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59.999Z`);

  const [{ data: rowsData, error }, { data: facetsData }] = await Promise.all([
    query,
    s.from('decision_reports').select('instrument,strategy_id,strategy_name').order('created_at', { ascending: false }).limit(500),
  ]);

  const rows = (rowsData ?? []).map((row) => ({ ...row, isSimulation: isSimulationDecisionReportRow(row) }));
  const instruments = [...new Set((facetsData ?? []).map((row) => row.instrument).filter(Boolean))].sort();
  const strategies = [...new Map((facetsData ?? []).map((row) => [row.strategy_id, row.strategy_name])).entries()]
    .filter(([, name]) => Boolean(name))
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));

  const normalRows = rows.filter((row) => !row.isSimulation);
  const total = normalRows.length;
  const ready = normalRows.filter((row) => row.verdict === 'READY').length;
  const waitingOrNoSetup = normalRows.filter((row) => ['WAIT', 'NO_SETUP'].includes(String(row.verdict))).length;
  const blockedOrUnavailable = normalRows.filter((row) => ['BLOCKED', 'DATA_UNAVAILABLE', 'STRATEGY_INCOMPLETE'].includes(String(row.verdict))).length;

  return (
    <main className="container history-page-shell">
      <AppHeader
        eyebrow="TRADE POLICE / HISTORY"
        displayName={displayName}
        description="Review past decisions and outcomes without recomputing them with later market data."
        userId={user.id}
      />

      <section className="card history-overview-card">
        <header className="history-header-row">
          <div>
            <p className="eyebrow">DECISION JOURNAL</p>
            <h1>History</h1>
            <p className="muted">Review the decisions you saved, the context they were made under, and the outcome information that was actually persisted.</p>
          </div>
          <a className="button-link secondary" href="/validate">Open decision workspace</a>
        </header>

        <div className="history-summary-grid">
          <div className="history-summary-box">
            <span>Total reports</span>
            <strong>{total}</strong>
          </div>
          <div className="history-summary-box">
            <span>Ready decisions</span>
            <strong>{ready}</strong>
          </div>
          <div className="history-summary-box">
            <span>Waiting / No setup</span>
            <strong>{waitingOrNoSetup}</strong>
          </div>
          <div className="history-summary-box">
            <span>Blocked / unavailable</span>
            <strong>{blockedOrUnavailable}</strong>
          </div>
        </div>
      </section>

      <section className="card history-list-card">
        <header className="history-list-header">
          <div>
            <p className="eyebrow">SAVED REPORTS</p>
            <h2>Decision archive</h2>
          </div>
          <p className="muted">Historical snapshots are never recalculated with later market data. They are saved exactly as they were produced.</p>
        </header>

        <form className="history-filter-bar" method="get">
          <label>
            <span>Search</span>
            <input name="q" defaultValue={filters.q ?? ''} placeholder="Instrument or strategy" />
          </label>
          <label>
            <span>Verdict</span>
            <select name="verdict" defaultValue={filters.verdict ?? ''}>
              <option value="">All verdicts</option>
              {verdicts.map((value) => <option key={value} value={value}>{formatVerdict(value)}</option>)}
            </select>
          </label>
          <label>
            <span>Instrument</span>
            <select name="instrument" defaultValue={filters.instrument ?? ''}>
              <option value="">All instruments</option>
              {instruments.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Strategy</span>
            <select name="strategy" defaultValue={filters.strategy ?? ''}>
              <option value="">All strategies</option>
              {strategies.map(([id, name]) => <option key={id} value={id}>{String(name)}</option>)}
            </select>
          </label>
          <label>
            <span>From</span>
            <input type="date" name="from" defaultValue={filters.from ?? ''} />
          </label>
          <label>
            <span>To</span>
            <input type="date" name="to" defaultValue={filters.to ?? ''} />
          </label>
          <div className="history-filter-actions">
            <button type="submit" className="primary">Apply</button>
            <a className="button-link secondary" href="/history">Clear</a>
          </div>
        </form>

        {error ? (
          <div className="history-empty-state error-state">
            <h3>History could not be loaded</h3>
            <p>The saved report list is temporarily unavailable. Please try again in a moment.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="history-empty-state empty-state">
            <h3>No saved decisions yet</h3>
            <p>Once you save a decision report, it will appear here for quick review and reference.</p>
            <a className="button-link primary" href="/validate">Review a live decision</a>
          </div>
        ) : (
          <div className="history-row-list">
            {rows.map((row) => {
              const verdict = String(row.verdict ?? 'UNKNOWN');
              const tone = verdictTone[verdict] ?? 'neutral';
              const verdictLabel = formatVerdict(verdict);
              const strategyName = row.strategy_name || 'Strategy not saved';
              const freshness = row.data_freshness ? row.data_freshness.replaceAll('_', ' ') : 'Not available';
              const primaryReason = row.primary_reason || 'No primary reason was recorded for this decision.';
              const isSimulation = row.isSimulation;

              return (
                <article key={row.id} className="history-row">
                  <div className="history-row-main">
                    <div className="history-row-head">
                      <div>
                        <span className="history-instrument-tag">{row.instrument}</span>
                        <span className="history-timeframe-tag">{row.timeframe}</span>
                      </div>
                      <span className={`history-badge tone-${isSimulation ? 'warning' : tone}`}>{isSimulation ? 'SIMULATION / INTERNAL TEST' : verdictLabel}</span>
                    </div>
                    <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                    <p>{isSimulation ? 'Visible for verification only; excluded from normal user-facing decision totals.' : primaryReason}</p>
                  </div>

                  <div className="history-row-meta">
                    <div>
                      <span>Strategy</span>
                      <strong>{strategyName}</strong>
                    </div>
                    <div>
                      <span>Freshness</span>
                      <strong>{freshness}</strong>
                    </div>
                    {row.market_provider ? (
                      <div>
                        <span>Provider</span>
                        <strong>{row.market_provider}</strong>
                      </div>
                    ) : null}
                    {isSimulation ? (
                      <div>
                        <span>Record type</span>
                        <strong>SIMULATION / INTERNAL TEST</strong>
                      </div>
                    ) : null}
                  </div>

                  <div className="history-row-action">
                    <a href={`/history/${row.id}`} className="button-link secondary">Open report</a>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
