'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type TabKey = 'overview' | 'rules' | 'backtests' | 'forward-test';

type StrategyRow = {
  id: string;
  name: string;
  description?: string | null;
  market_types?: string[] | null;
  instruments?: string[] | null;
  macro_timeframe?: string | null;
  trend_timeframe?: string | null;
  confirmation_timeframe?: string | null;
  entry_timeframe?: string | null;
  trigger_timeframe?: string | null;
  maximum_risk_percent?: number | null;
  minimum_rr?: number | null;
  authorization_score?: number | null;
  wait_score?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_default?: boolean | null;
  allowed_sessions?: string[] | null;
  required_evidence?: string[] | null;
  stop_limits?: Record<string, number> | null;
};

type RuleRow = {
  id?: string;
  rule_key?: string | null;
  label?: string | null;
  enabled?: boolean | null;
  mandatory?: boolean | null;
  weight?: number | null;
  minimum_confidence?: number | null;
  timeframe_role?: string | null;
  evaluation_mode?: string | null;
};

type SessionRow = {
  id?: string;
  session_code?: string | null;
  name?: string | null;
  timezone?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

type BacktestRunRow = {
  id: string;
  strategy_profile_id: string;
  status: string;
  strategy_revision_id?: string | null;
  instrument?: string | null;
  execution_timeframe?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  created_at?: string | null;
  starting_balance?: number | null;
  metadata?: Record<string, unknown> | null;
};

type StrategyDetailPageProps = {
  strategy: StrategyRow;
  rules: RuleRow[];
  sessions: SessionRow[];
  initialRuns: BacktestRunRow[];
  planCode: string;
};

const BACKTEST_LIMITS: Record<string, number> = {
  FREE: 0,
  PRO: 3,
  ELITE: 10,
  TEAM: 70,
};

const pad = (value: number) => String(value).padStart(2, '0');

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRange(start?: string | null, end?: string | null) {
  if (!start || !end) return '—';
  return `${formatDate(start)} → ${formatDate(end)}`;
}

function getPlanLimit(planCode: string) {
  return BACKTEST_LIMITS[String(planCode).toUpperCase()] ?? 0;
}

function getWindowForPreset(preset: string) {
  const now = new Date();
  const start = new Date(now.getTime());
  const end = new Date(now.getTime());

  if (preset === '1M') {
    start.setUTCMonth(start.getUTCMonth() - 1);
  } else if (preset === '3M') {
    start.setUTCMonth(start.getUTCMonth() - 3);
  } else if (preset === '6M') {
    start.setUTCMonth(start.getUTCMonth() - 6);
  } else {
    start.setUTCMonth(start.getUTCMonth() - 3);
  }

  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  };
}

export default function StrategyDetailPage({ strategy, rules, sessions, initialRuns, planCode }: StrategyDetailPageProps) {
  const [tab, setTab] = useState<TabKey>('overview');
  const [runs, setRuns] = useState(initialRuns);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRuns[0]?.id ?? null);
  const [form, setForm] = useState({
    instrument: Array.isArray(strategy.instruments) && strategy.instruments.length > 0 ? strategy.instruments[0] : 'XAUUSD',
    periodPreset: '3M',
    customStart: '',
    customEnd: '',
    startingBalance: '10000',
    executionModel: 'STANDARD',
  });

  const limitValue = getPlanLimit(planCode);
  const monthlyRuns = useMemo(() => {
    const now = new Date();
    return runs.filter((run) => {
      const createdAt = run.created_at ? new Date(run.created_at) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
      return createdAt.getUTCFullYear() === now.getUTCFullYear() && createdAt.getUTCMonth() === now.getUTCMonth();
    });
  }, [runs]);
  const usageCount = monthlyRuns.length;
  const usagePercent = limitValue > 0 ? Math.min(100, (usageCount / limitValue) * 100) : 0;
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

  async function refreshBacktests() {
    const response = await fetch('/api/backtests', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    setRuns(items.filter((run: BacktestRunRow) => run.strategy_profile_id === strategy.id));
  }

  async function handleCreateBacktest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      const chosenPeriod = form.periodPreset === 'Custom' ? {
        periodStart: form.customStart ? new Date(form.customStart).toISOString() : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        periodEnd: form.customEnd ? new Date(form.customEnd).toISOString() : new Date().toISOString(),
      } : getWindowForPreset(form.periodPreset);

      const payload = {
        strategyProfileId: strategy.id,
        instrument: form.instrument,
        executionTimeframe: 'M15',
        periodStart: chosenPeriod.periodStart,
        periodEnd: chosenPeriod.periodEnd,
        startingBalance: Number(form.startingBalance) || 10000,
        riskConfiguration: { mode: 'conservative' },
        executionModel: { mode: form.executionModel },
        engineVersion: '1.0.0',
        dataProvider: 'Twelve Data',
        dataRevisionFingerprint: '',
        metadata: {
          strategyDetailUi: true,
          periodPreset: form.periodPreset,
        },
      };

      const response = await fetch('/api/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error?.message || 'Backtest creation failed.');
      }

      setMessage(`Queued ${form.instrument} backtest for ${strategy.name}.`);
      setFormOpen(false);
      await refreshBacktests();
      if (result?.runId) {
        setSelectedRunId(result.runId);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to queue the backtest.';
      setMessage(text);
    } finally {
      setSaving(false);
    }
  }

  const strategyRules = rules.filter((rule) => rule.enabled !== false || rule.mandatory);

  return (
    <main className="container" style={{ maxWidth: 1320 }}>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="button-row" style={{ marginTop: 0, justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p className="eyebrow">STRATEGY DETAIL</p>
            <h1 style={{ margin: '6px 0 4px' }}>{strategy.name}</h1>
            <small className="muted">{strategy.description || 'No description saved.'}</small>
          </div>
          <div className="button-row" style={{ marginTop: 0 }}>
            <Link className="button-link secondary" href="/profile">Back to Strategies</Link>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="button-row" style={{ marginTop: 0, alignItems: 'center' }}>
          {(['overview', 'rules', 'backtests', 'forward-test'] as TabKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={tab === key ? 'primary' : 'secondary'}
              onClick={() => setTab(key)}
              style={{ minWidth: 120 }}
            >
              {key === 'overview' ? 'Overview' : key === 'rules' ? 'Rules' : key === 'backtests' ? 'Backtests' : 'Forward Test'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="grid grid-3">
          <section className="card">
            <p className="eyebrow">PROFILE</p>
            <h3>Strategy summary</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', display: 'grid', gap: 8 }}>
              <li><strong>Instruments:</strong> {(strategy.instruments ?? []).join(', ') || '—'}</li>
              <li><strong>Timeframes:</strong> {strategy.macro_timeframe || '—'} / {strategy.trend_timeframe || '—'} / {strategy.confirmation_timeframe || '—'} / {strategy.entry_timeframe || '—'} / {strategy.trigger_timeframe || '—'}</li>
              <li><strong>Risk:</strong> {strategy.maximum_risk_percent ?? '—'}%</li>
              <li><strong>Min RR:</strong> {strategy.minimum_rr ?? '—'}</li>
              <li><strong>Signal readiness:</strong> {strategy.authorization_score ?? '—'}% / wait {strategy.wait_score ?? '—'}%</li>
              <li><strong>Sessions:</strong> {(strategy.allowed_sessions ?? sessions.map((s) => s.session_code ?? '') ?? []).join(', ') || '—'}</li>
            </ul>
          </section>

          <section className="card">
            <p className="eyebrow">RULES</p>
            <h3>{strategyRules.length} enabled</h3>
            <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
              {strategyRules.slice(0, 5).map((rule) => (
                <div key={rule.rule_key || Math.random()} className="card" style={{ padding: 12, margin: 0 }}>
                  <strong>{rule.label || rule.rule_key || 'Rule'}</strong>
                  <small className="muted" style={{ display: 'block' }}>{rule.timeframe_role || 'General'} · {rule.evaluation_mode || 'AUTOMATIC'}</small>
                </div>
              ))}
              {strategyRules.length === 0 && <p className="muted">No enabled rules saved yet.</p>}
            </div>
          </section>

          <section className="card">
            <p className="eyebrow">BACKTESTING</p>
            <h3>V1 readiness</h3>
            <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
              <div>
                <div className="button-row" style={{ marginTop: 0, justifyContent: 'space-between' }}>
                  <strong>{usageCount}</strong>
                  <small className="muted">{limitValue === 0 ? 'No backtest plan access' : `${limitValue} max / month`}</small>
                </div>
                <div style={{ width: '100%', background: 'rgba(255,255,255,0.05)', height: 10, borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${usagePercent}%`, background: 'linear-gradient(90deg, #7aa2ff, #4cd7a9)', height: '100%' }} />
                </div>
              </div>
              <button type="button" className="primary" onClick={() => setFormOpen((current) => !current)}>Run Backtest</button>
            </div>
          </section>
        </div>
      )}

      {tab === 'rules' && (
        <section className="card">
          <p className="eyebrow">RULES</p>
          <h3>Configured rule set</h3>
          <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
            {strategyRules.length === 0 ? (
              <p className="muted">No rules have been configured for this strategy.</p>
            ) : (
              strategyRules.map((rule) => (
                <div key={rule.rule_key || Math.random()} className="card" style={{ padding: 16, margin: 0 }}>
                  <div className="button-row" style={{ justifyContent: 'space-between', marginTop: 0 }}>
                    <strong>{rule.label || rule.rule_key || 'Rule'}</strong>
                    <span className="badge">{rule.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                  <small className="muted" style={{ display: 'block', marginTop: 8 }}>
                    {rule.timeframe_role || 'General'} · {rule.evaluation_mode || 'AUTOMATIC'} · Weight {rule.weight ?? 0} · Min confidence {rule.minimum_confidence ?? 0}
                  </small>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === 'backtests' && (
        <div className="stack">
          <section className="card">
            <div className="button-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
              <div>
                <p className="eyebrow">BACKTESTS</p>
                <h3>Monthly usage</h3>
              </div>
              <button type="button" className="primary" onClick={() => setFormOpen((current) => !current)}>Run Backtest</button>
            </div>

            <div style={{ marginTop: 18 }}>
              <div className="button-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
                <strong>{usageCount}</strong>
                <small className="muted">Plan: {planCode || 'FREE'} · limit {limitValue}</small>
              </div>
              <div style={{ width: '100%', background: 'rgba(255,255,255,0.05)', height: 12, borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ width: `${usagePercent}%`, background: 'linear-gradient(90deg, #7aa2ff, #4cd7a9)', height: '100%' }} />
              </div>
            </div>

            {formOpen && (
              <form onSubmit={handleCreateBacktest} style={{ marginTop: 20, display: 'grid', gap: 16, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="grid grid-2">
                  <label>
                    Instrument
                    <select value={form.instrument} onChange={(event) => setForm((current) => ({ ...current, instrument: event.target.value }))}>
                      {(strategy.instruments ?? ['XAUUSD']).map((instrument) => (
                        <option key={instrument} value={instrument}>{instrument}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Period
                    <select value={form.periodPreset} onChange={(event) => setForm((current) => ({ ...current, periodPreset: event.target.value }))}>
                      <option value="1M">1M</option>
                      <option value="3M">3M</option>
                      <option value="6M">6M</option>
                      <option value="Custom">Custom</option>
                    </select>
                  </label>

                  <label>
                    Starting balance
                    <input type="number" min="1" value={form.startingBalance} onChange={(event) => setForm((current) => ({ ...current, startingBalance: event.target.value }))} />
                  </label>

                  <label>
                    Execution model
                    <select value={form.executionModel} onChange={(event) => setForm((current) => ({ ...current, executionModel: event.target.value }))}>
                      <option value="STANDARD">Standard</option>
                      <option value="CONSERVATIVE">Conservative</option>
                    </select>
                  </label>
                </div>

                {form.periodPreset === 'Custom' && (
                  <div className="grid grid-2">
                    <label>
                      Start date
                      <input type="date" value={form.customStart} onChange={(event) => setForm((current) => ({ ...current, customStart: event.target.value }))} />
                    </label>
                    <label>
                      End date
                      <input type="date" value={form.customEnd} onChange={(event) => setForm((current) => ({ ...current, customEnd: event.target.value }))} />
                    </label>
                  </div>
                )}

                <div className="button-row" style={{ marginTop: 0 }}>
                  <button type="submit" className="primary" disabled={saving}>{saving ? 'Queueing…' : 'Queue Backtest'}</button>
                  <button type="button" className="secondary" onClick={() => setFormOpen(false)}>Cancel</button>
                </div>
              </form>
            )}

            {message && <p className="muted" style={{ marginTop: 14 }}>{message}</p>}
          </section>

          <section className="card">
            <p className="eyebrow">RUN HISTORY</p>
            <h3>Past runs</h3>
            <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
              {runs.length === 0 ? (
                <p className="muted">No backtests have been queued for this strategy yet.</p>
              ) : (
                runs.map((run) => (
                  <div key={run.id} className="card" style={{ padding: 16, margin: 0 }}>
                    <div className="button-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
                      <div>
                        <strong>{run.instrument || 'XAUUSD'}</strong>
                        <small className="muted" style={{ display: 'block' }}>{run.status}</small>
                      </div>
                      <button type="button" className="secondary" onClick={() => setSelectedRunId(run.id)}>View Report</button>
                    </div>
                    <div className="grid grid-3" style={{ marginTop: 12 }}>
                      <div><small className="muted">Revision</small><div>{run.strategy_revision_id || '—'}</div></div>
                      <div><small className="muted">Period</small><div>{formatRange(run.period_start, run.period_end)}</div></div>
                      <div><small className="muted">Created</small><div>{formatDate(run.created_at)}</div></div>
                    </div>
                    <div className="grid grid-3" style={{ marginTop: 12 }}>
                      <div><small className="muted">Total trades</small><div>{run.metadata && typeof run.metadata === 'object' && 'total_trades' in run.metadata ? String((run.metadata as any).total_trades ?? '—') : '—'}</div></div>
                      <div><small className="muted">Net return</small><div>{run.metadata && typeof run.metadata === 'object' && 'net_return' in run.metadata ? String((run.metadata as any).net_return ?? '—') : '—'}</div></div>
                      <div><small className="muted">Max drawdown</small><div>{run.metadata && typeof run.metadata === 'object' && 'max_drawdown' in run.metadata ? String((run.metadata as any).max_drawdown ?? '—') : '—'}</div></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {selectedRun && (
            <section className="card">
              <p className="eyebrow">REPORT</p>
              <h3>Selected backtest</h3>
              <div className="grid grid-3" style={{ marginTop: 10 }}>
                <div><small className="muted">Status</small><div>{selectedRun.status}</div></div>
                <div><small className="muted">Strategy revision</small><div>{selectedRun.strategy_revision_id || '—'}</div></div>
                <div><small className="muted">Created</small><div>{formatDate(selectedRun.created_at)}</div></div>
              </div>
              <div className="button-row" style={{ marginTop: 18 }}>
                <button type="button" className="secondary" disabled>View Report</button>
              </div>
            </section>
          )}
        </div>
      )}

      {tab === 'forward-test' && (
        <section className="card">
          <p className="eyebrow">FORWARD TEST</p>
          <h3>Phase 2 placeholder</h3>
          <p className="muted" style={{ marginTop: 12 }}>Forward test execution is intentionally out of scope for Backtesting V1 Phase 1. This tab will be wired to the live validation and monitoring flow in the next phase.</p>
        </section>
      )}
    </main>
  );
}
