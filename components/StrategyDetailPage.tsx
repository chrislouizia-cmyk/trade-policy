'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isBacktestLeaseStale } from '@/lib/backtesting/run-lifecycle';
import { normalizeStrategyInstruments, resolveBacktestInstrument } from '@/lib/backtesting/instrument-selection';
import styles from './StrategyDetailPage.module.css';

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
  started_at?: string | null;
  starting_balance?: number | null;
  metadata?: Record<string, unknown> | null;
};

type OpportunityFunnel = {
  execution_candles_evaluated?: number;
  multi_timeframe_context_ready?: number;
  analysis_completed?: number;
  ready_candidate_found?: number;
  setup_readiness_ready?: number;
  direction_allowed?: number;
  daily_limit_allowed?: number;
  valid_risk_geometry?: number;
  executable_signals?: number;
  completed_trades?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type StrategyDetailPageProps = {
  strategy: StrategyRow;
  rules: RuleRow[];
  sessions: SessionRow[];
  initialRuns: BacktestRunRow[];
  planCode: string;
};

type BacktestResultRow = {
  run_id: string;
  ending_balance?: number | null;
  net_return_percent?: number | null;
  total_trades?: number | null;
  wins?: number | null;
  losses?: number | null;
  breakeven?: number | null;
  win_rate?: number | null;
  profit_factor?: number | null;
  expectancy_r?: number | null;
  average_r?: number | null;
  max_drawdown_percent?: number | null;
  max_drawdown_amount?: number | null;
  gross_profit?: number | null;
  gross_loss?: number | null;
  total_costs?: number | null;
};

type BacktestTradeRow = {
  id: string;
  sequence: number;
  direction: 'LONG' | 'SHORT';
  entry_timestamp: string;
  exit_timestamp?: string | null;
  entry: number;
  exit_price?: number | null;
  net_pnl?: number | null;
  net_r?: number | null;
  session?: string | null;
  entry_reason?: string | null;
  exit_reason?: string | null;
};

const BACKTEST_LIMITS: Record<string, number | null> = {
  FREE: 1,
  PRIVATE_BETA: 10,
  PRO: 3,
  ELITE: 10,
  TEAM: 70,
  FOUNDER: null,
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

function normalizeBacktestPlanCode(planCode: string | null | undefined) {
  return String(planCode ?? 'FREE').trim().toUpperCase();
}

function getPlanLimit(planCode: string | null | undefined): number | null {
  const normalizedPlanCode = normalizeBacktestPlanCode(planCode);
  return normalizedPlanCode in BACKTEST_LIMITS ? BACKTEST_LIMITS[normalizedPlanCode] : 0;
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
  const enabledBacktestInstruments = useMemo(
    () => normalizeStrategyInstruments(strategy.instruments),
    [strategy.instruments],
  );
  const enabledBacktestInstrumentKey = enabledBacktestInstruments.join('|');
  const [tab, setTab] = useState<TabKey>('overview');
  const [runs, setRuns] = useState(initialRuns);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRuns[0]?.id ?? null);
  const [reportResult, setReportResult] = useState<BacktestResultRow | null>(null);
  const [reportTrades, setReportTrades] = useState<BacktestTradeRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [form, setForm] = useState({
    instrument: resolveBacktestInstrument(null, strategy.instruments),
    periodPreset: '3M',
    customStart: '',
    customEnd: '',
    startingBalance: '10000',
    executionModel: 'STANDARD',
  });

  const normalizedPlanCode = normalizeBacktestPlanCode(planCode);
  const limitValue = getPlanLimit(normalizedPlanCode);
  const usageCount = useMemo(() => {
    const completed = runs.filter((run) => run.status === 'COMPLETED');
    if (normalizedPlanCode === 'FREE') return completed.length;
    const now = new Date();
    return completed.filter((run) => {
      const createdAt = run.created_at ? new Date(run.created_at) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
      return createdAt.getUTCFullYear() === now.getUTCFullYear() && createdAt.getUTCMonth() === now.getUTCMonth();
    }).length;
  }, [runs, normalizedPlanCode]);
  const reservedCount = runs.filter((run) => run.status === 'QUEUED' || run.status === 'RUNNING').length;
  const chargeableCount = usageCount + reservedCount;
  const remainingCredits = limitValue === null ? null : Math.max(0, limitValue - chargeableCount);
  const usagePercent = limitValue === null ? 0 : (limitValue > 0 ? Math.min(100, (chargeableCount / limitValue) * 100) : 0);
  const usageWindowLabel = normalizedPlanCode === 'FREE' ? 'Lifetime usage' : 'Monthly usage';
  const backtestStatusLabel = limitValue === null
    ? (normalizedPlanCode === 'FOUNDER' ? `${usageCount} completed - Founder access` : `${usageCount} completed - Unlimited`)
    : `${usageCount} completed${reservedCount ? ` - ${reservedCount} reserved` : ''} - ${remainingCredits} available`;
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const selectedRunMetadata = asRecord(selectedRun?.metadata);
  const opportunityFunnel = asRecord(selectedRunMetadata?.opportunity_funnel) as OpportunityFunnel | null;
  const sampleQuality = asRecord(selectedRunMetadata?.sample_quality);
  const effectivePeriodEnd = typeof selectedRunMetadata?.effective_period_end === 'string'
    ? selectedRunMetadata.effective_period_end
    : null;
  const dataFreshnessSeconds = numberValue(selectedRunMetadata?.data_freshness_seconds);

  useEffect(() => {
    setForm((current) => {
      const instrument = resolveBacktestInstrument(current.instrument, enabledBacktestInstruments);
      return instrument === current.instrument ? current : { ...current, instrument };
    });
  }, [strategy.id, enabledBacktestInstrumentKey]);

  function handleBackToStrategies() {
    window.location.assign('/profile');
  }

  function handleEditStrategy() {
    if (!strategy.id) return;
    window.location.assign(`/profile?strategy=${encodeURIComponent(strategy.id)}&mode=edit`);
  }

  function handleDuplicateStrategy() {
    if (!strategy.id) return;
    window.location.assign(`/profile?strategy=${encodeURIComponent(strategy.id)}&mode=duplicate`);
  }

  async function refreshBacktests() {
    try {
      const response = await fetch('/api/backtests', { cache: 'no-store' });
      if (!response.ok) {
        console.warn('Backtest refresh returned a non-success response', { status: response.status });
        return;
      }
      const payload = await response.json();
      const items = Array.isArray(payload.items) ? payload.items : [];
      setRuns(items.filter((run: BacktestRunRow) => run.strategy_profile_id === strategy.id));
    } catch (error) {
      console.warn('Backtest refresh temporarily unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  useEffect(() => {
    const hasActiveRun = runs.some((run) => run.status === 'QUEUED' || run.status === 'RUNNING');
    if (!hasActiveRun) return;

    const timer = window.setInterval(() => { void refreshBacktests(); }, 2500);
    return () => window.clearInterval(timer);
  }, [runs, strategy.id]);

  useEffect(() => {
    if (!reportModalOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleReportEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setReportModalOpen(false);
    };

    window.addEventListener('keydown', handleReportEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleReportEscape);
    };
  }, [reportModalOpen]);

  async function openRunReport(run: BacktestRunRow) {
    setSelectedRunId(run.id);
    setReportModalOpen(true);
    setReportLoading(true);
    setReportError('');
    setReportResult(null);
    setReportTrades([]);

    if (run.status !== 'COMPLETED') {
      setReportLoading(false);
      setReportError(`This run is ${run.status}. The full report becomes available after it completes.`);
      return;
    }

    const supabase = createClient();
    const [{ data: result, error: resultError }, { data: trades, error: tradesError }] = await Promise.all([
      supabase.from('backtest_results').select('*').eq('run_id', run.id).maybeSingle(),
      supabase.from('backtest_trades').select('*').eq('run_id', run.id).order('sequence', { ascending: true }),
    ]);

    if (resultError || tradesError) {
      setReportError(resultError?.message || tradesError?.message || 'Backtest report could not be loaded.');
    } else if (!result) {
      setReportError('The run completed, but its persisted result is not available yet. Refresh in a moment.');
    } else {
      setReportResult(result as BacktestResultRow);
      setReportTrades((trades ?? []) as BacktestTradeRow[]);
    }
setReportLoading(false);
  }

  async function executeQueuedRun(runId: string) {
    const currentRun = runs.find((run) => run.id === runId);
    setMessage(currentRun?.status === 'RUNNING' ? 'Checking the active backtest lease…' : 'Running historical replay…');
    try {
      const response = await fetch(`/api/backtests/${runId}/execute`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      await refreshBacktests();
      if (!response.ok) {
        setMessage(payload?.error?.message || payload?.message || 'Backtest execution failed. The reserved credit was released when possible.');
        return;
      }
      if (payload?.status === 'COMPLETED') {
        setMessage('Backtest completed. Open View Report to review the persisted results.');
      } else if (payload?.continuationRequired && payload?.status === 'QUEUED') {
        const retryAfterSeconds = Math.max(1, Number(payload?.retryAfterSeconds || 1));
        setMessage(payload?.message || `Historical replay is ${Number(payload?.progressPercent || 0).toFixed(0)}% complete. Continuing automatically…`);
        window.setTimeout(() => { void executeQueuedRun(runId); }, retryAfterSeconds * 1000);
      } else if (payload?.preparingHistoricalData && payload?.status === 'QUEUED') {
        const retryAfterSeconds = Math.max(5, Number(payload?.retryAfterSeconds || 65));
        setMessage(payload?.message || 'Historical data is being prepared. Trade Police will continue shortly.');
        window.setTimeout(() => { void executeQueuedRun(runId); }, retryAfterSeconds * 1000);
      } else {
        const retryAfterSeconds = Math.max(5, Number(payload?.retryAfterSeconds || 15));
        if (payload?.status === 'RUNNING') {
          setMessage(`Backtest execution is still active. Checking again in about ${retryAfterSeconds} seconds…`);
          window.setTimeout(() => { void executeQueuedRun(runId); }, retryAfterSeconds * 1000);
        } else {
          setMessage(`Backtest status: ${payload?.status || 'RUNNING'}.`);
        }
      }
    } catch {
      setMessage('The connection was interrupted, but the backtest is safe. Reconnecting automatically…');
      await refreshBacktests();
      window.setTimeout(() => { void executeQueuedRun(runId); }, 15_000);
    }
  }

  function openBacktestForm() {
    setTab('backtests');
    setFormOpen(true);
  }

  async function handleCreateBacktest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      const selectedInstrument = resolveBacktestInstrument(form.instrument, enabledBacktestInstruments);
      if (!selectedInstrument) {
        throw new Error('Enable at least one instrument for this strategy before running a backtest.');
      }

      const chosenPeriod = form.periodPreset === 'Custom' ? {
        periodStart: form.customStart ? new Date(form.customStart).toISOString() : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        periodEnd: form.customEnd ? new Date(form.customEnd).toISOString() : new Date().toISOString(),
      } : getWindowForPreset(form.periodPreset);

      const payload = {
        strategyProfileId: strategy.id,
        instrument: selectedInstrument,
        executionTimeframe: strategy.trigger_timeframe || strategy.entry_timeframe || 'M15',
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

      setFormOpen(false);
      if (result?.runId) {
        setSelectedRunId(result.runId);
        setMessage(`Queued ${selectedInstrument} backtest for ${strategy.name}. Starting historical replay…`);
        await executeQueuedRun(result.runId);
      } else {
        await refreshBacktests();
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to queue the backtest.';
      setMessage(text);
    } finally {
      setSaving(false);
    }
  }

  const strategyRules = rules.filter((rule) => rule.enabled !== false || rule.mandatory);
  const strategySessions = (strategy.allowed_sessions && strategy.allowed_sessions.length ? strategy.allowed_sessions : sessions.map((s) => s.session_code ?? '')).filter(Boolean);

  return (
    <main className="strategy-detail-shell" style={{ width: '100%', maxWidth: 'none' }}>
      <section className="card strategy-detail-header" aria-label="Strategy detail header">
        <div className="strategy-detail-header-row">
          <div className="strategy-detail-heading">
            <p className="eyebrow">STRATEGY DETAIL</p>
            <div className="strategy-detail-title-row">
              <h1>{strategy.name}</h1>
              <div className="button-row" style={{ marginTop: 0 }}>
                <button type="button" className="button-link secondary strategy-detail-back-link" onClick={handleBackToStrategies}>Back to Strategies</button>
                <button type="button" className="button-link secondary" onClick={handleEditStrategy}>Edit strategy</button>
                <button type="button" className="button-link secondary" onClick={handleDuplicateStrategy}>Duplicate</button>
              </div>
            </div>
            <small className="muted strategy-detail-subtitle">{strategy.description || 'No description saved.'}</small>
          </div>
        </div>

        <div className="button-row strategy-detail-tabs" style={{ marginTop: 0 }}>
          {(['overview', 'rules', 'backtests', 'forward-test'] as TabKey[]).map((key) => {
            const comingSoon = key === 'forward-test';
            return (
              <button
                key={key}
                type="button"
                className={tab === key ? 'primary strategy-detail-tab active' : 'secondary strategy-detail-tab'}
                onClick={() => { if (!comingSoon) setTab(key); }}
                disabled={comingSoon}
                title={comingSoon ? 'Forward Test is not available yet.' : undefined}
              >
                {key === 'overview' ? 'Overview' : key === 'rules' ? 'Rules' : key === 'backtests' ? 'Backtests' : 'Forward Test - Coming soon'}
              </button>
            );
          })}
        </div>
      </section>

      <div className={`card strategy-detail-panel ${styles.detailPanel}`}>
        <div className={`strategy-detail-tab-panel ${styles.tabPanel}`}>
          {tab === 'overview' && (
            <div className="grid grid-3 strategy-detail-grid strategy-detail-view">
              <section className="card strategy-detail-card">
                <p className="eyebrow">PROFILE</p>
                <h3>Strategy summary</h3>
                <div className="strategy-detail-summary-list">
                  <div className="strategy-detail-meta-row"><span>Instruments</span><strong>{(strategy.instruments ?? []).join(', ') || '—'}</strong></div>
                  <div className="strategy-detail-meta-row"><span>Timeframes</span><strong>{strategy.macro_timeframe || '—'} / {strategy.trend_timeframe || '—'} / {strategy.confirmation_timeframe || '—'} / {strategy.entry_timeframe || '—'} / {strategy.trigger_timeframe || '—'}</strong></div>
                  <div className="strategy-detail-meta-row"><span>Risk</span><strong>{strategy.maximum_risk_percent ?? '—'}%</strong></div>
                  <div className="strategy-detail-meta-row"><span>Min RR</span><strong>{strategy.minimum_rr ?? '—'}</strong></div>
                  <div className="strategy-detail-meta-row"><span>Signal readiness</span><strong>{strategy.authorization_score ?? '—'}% / wait {strategy.wait_score ?? '—'}%</strong></div>
                  <div className="strategy-detail-meta-row strategy-detail-meta-row-wrap">
                    <span>Sessions</span>
                    <strong className="strategy-detail-chip-list">
                      {strategySessions.length ? strategySessions.map((session) => (
                        <span key={session} className="strategy-detail-chip">{session}</span>
                      )) : <span className="muted">—</span>}
                    </strong>
                  </div>
                </div>
              </section>

              <section className="card strategy-detail-card">
                <p className="eyebrow">RULES</p>
                <h3>{strategyRules.length} enabled</h3>
                <div className="strategy-detail-rule-stack">
                  {strategyRules.slice(0, 5).map((rule) => (
                    <div key={rule.rule_key || Math.random()} className="strategy-detail-rule-card">
                      <strong>{rule.label || rule.rule_key || 'Rule'}</strong>
                      <small className="muted">{rule.timeframe_role || 'General'} · {rule.evaluation_mode || 'AUTOMATIC'}</small>
                    </div>
                  ))}
                  {strategyRules.length === 0 && <p className="muted">No enabled rules saved yet.</p>}
                </div>
              </section>

              <section className="card strategy-detail-card">
                <p className="eyebrow">BACKTESTING</p>
                <h3>V1 readiness</h3>
                <div className="strategy-detail-backtest-stack">
                  <div>
                    <div className="strategy-detail-usage-row">
                      <strong>{usageCount}</strong>
                      <small className="muted">{backtestStatusLabel}</small>
                    </div>
                    <div className="strategy-detail-progress-track">
                      <div className="strategy-detail-progress-fill" style={{ width: `${usagePercent}%` }} />
                    </div>
                  </div>
                  <button type="button" className="primary" onClick={openBacktestForm}>Run Backtest</button>
                </div>
              </section>
            </div>
          )}

          {tab === 'rules' && (
            <section className="card strategy-detail-section-card strategy-detail-view">
              <p className="eyebrow">RULES</p>
              <h3>Configured rule set</h3>
              <div className="strategy-detail-rule-list">
                {strategyRules.length === 0 ? (
                  <p className="muted">No rules have been configured for this strategy.</p>
                ) : (
                  strategyRules.map((rule) => (
                    <div key={rule.rule_key || Math.random()} className="strategy-detail-rule-card compact">
                      <div className="strategy-detail-rule-header">
                        <strong>{rule.label || rule.rule_key || 'Rule'}</strong>
                        <span className="badge">{rule.enabled ? 'Enabled' : 'Disabled'}</span>
                      </div>
                      <small className="muted">
                        {rule.timeframe_role || 'General'} · {rule.evaluation_mode || 'AUTOMATIC'} · Weight {rule.weight ?? 0} · Min confidence {rule.minimum_confidence ?? 0}
                      </small>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {tab === 'backtests' && (
            <div className="stack strategy-detail-backtests-stack strategy-detail-view">
              <section className="card strategy-detail-section-card">
                <div className="strategy-detail-header-row strategy-detail-backtests-head">
                  <div>
                    <p className="eyebrow">BACKTESTS</p>
                    <h3>{usageWindowLabel}</h3>
                  </div>
                  <button type="button" className="primary" onClick={openBacktestForm}>Run Backtest</button>
                </div>

                <div className="strategy-detail-backtest-summary">
                  <div className="strategy-detail-usage-row">
                    <strong>{usageCount}</strong>
                    <small className="muted">Plan: {normalizedPlanCode || 'FREE'} · {limitValue === null ? 'Unlimited' : `${remainingCredits} of ${limitValue} credits left`}</small>
                  </div>
                  <div className="strategy-detail-progress-track large">
                    <div className="strategy-detail-progress-fill" style={{ width: `${usagePercent}%` }} />
                  </div>
                </div>

                {formOpen && (
                  <form onSubmit={handleCreateBacktest} style={{ marginTop: 20, display: 'grid', gap: 16, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="grid grid-2">
                      <label>
                        Instrument
                        <select value={form.instrument} onChange={(event) => setForm((current) => ({ ...current, instrument: event.target.value }))}>
                          {enabledBacktestInstruments.length === 0 && <option value="">No enabled instruments</option>}
                          {enabledBacktestInstruments.map((instrument) => (
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
                      <button type="submit" className="primary" disabled={saving || enabledBacktestInstruments.length === 0}>{saving ? 'Queueing…' : 'Queue Backtest'}</button>
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
                      <div key={run.id} className="card strategy-detail-run-card" style={{ padding: 16, margin: 0 }}>
                        <div className="button-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 0, gap: 12, flexWrap: 'wrap' }}>
                          <div style={{ minWidth: 0 }}>
                            <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{run.instrument || 'XAUUSD'}</strong>
                            <small className="muted" style={{ display: 'block' }}>{run.status}</small>
                          </div>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              if (run.status === 'QUEUED') void executeQueuedRun(run.id);
                              else if (run.status === 'RUNNING') void executeQueuedRun(run.id);
                              else void openRunReport(run);
                            }}
                          >
                            {run.status === 'COMPLETED'
                              ? 'View Report'
                              : run.status === 'FAILED'
                                ? 'View Failure'
                                : run.status === 'QUEUED'
                                  ? 'Run now'
                                  : isBacktestLeaseStale(run)
                                    ? 'Recover run'
                                    : 'Refresh status'}
                          </button>
                        </div>
                        <div className="grid grid-3 strategy-detail-metrics" style={{ marginTop: 12 }}>
                          <div><small className="muted">Revision</small><div>{run.strategy_revision_id || '—'}</div></div>
                          <div><small className="muted">Period</small><div>{formatRange(run.period_start, run.period_end)}</div></div>
                          <div><small className="muted">Created</small><div>{formatDate(run.created_at)}</div></div>
                        </div>
                        <div className="grid grid-3 strategy-detail-metrics" style={{ marginTop: 12 }}>
                          <div><small className="muted">Total trades</small><div>{run.metadata && typeof run.metadata === 'object' && 'total_trades' in run.metadata ? String((run.metadata as any).total_trades ?? '—') : '—'}</div></div>
                          <div><small className="muted">Net return</small><div>{run.metadata && typeof run.metadata === 'object' && 'net_return' in run.metadata ? String((run.metadata as any).net_return ?? '—') : '—'}</div></div>
                          <div><small className="muted">Max drawdown</small><div>{run.metadata && typeof run.metadata === 'object' && 'max_drawdown' in run.metadata ? String((run.metadata as any).max_drawdown ?? '—') : '—'}</div></div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {selectedRun && reportModalOpen && (
        <div
          className={styles.reportModalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setReportModalOpen(false);
          }}
        >
          <div className={styles.reportModalShell} role="dialog" aria-modal="true" aria-label="Backtest report">
            <button
              type="button"
              className={styles.reportModalClose}
              onClick={() => setReportModalOpen(false)}
              aria-label="Close backtest report"
            >
              ×
            </button>
<section
                  id="backtest-report"
                  className={`card ${styles.reportCard} ${styles.reportModalCard}`}
                    tabIndex={-1}
                  >
                  <div className={styles.reportHeader}>
                    <div>
                      <p className="eyebrow">BACKTEST REPORT</p>
                      <h3>{selectedRun.instrument || 'Backtest'} · {formatRange(selectedRun.period_start, selectedRun.period_end)}</h3>
                    </div>
                    <span className={styles.statusPill}>{selectedRun.status}</span>
                  </div>
                  {reportLoading && <p className="muted">Loading persisted backtest result…</p>}
                  {reportError && <p className={styles.reportNotice}>{reportError}</p>}
                  {reportResult && (
                    <>
                      <div className={styles.reportMetrics}>
                        <div><small>Net return</small><strong>{reportResult.net_return_percent ?? '—'}%</strong></div>
                        <div><small>Ending balance</small><strong>{reportResult.ending_balance ?? '—'}</strong></div>
                        <div><small>Total trades</small><strong>{reportResult.total_trades ?? reportTrades.length}</strong></div>
                        <div><small>Win rate</small><strong>{reportResult.win_rate ?? '—'}%</strong></div>
                        <div><small>Wins / losses</small><strong>{reportResult.wins ?? '—'} / {reportResult.losses ?? '—'}</strong></div>
                        <div><small>Max drawdown</small><strong>{reportResult.max_drawdown_percent ?? '—'}%</strong></div>
                        <div><small>Profit factor</small><strong>{reportResult.profit_factor ?? '—'}</strong></div>
                        <div><small>Expectancy</small><strong>{reportResult.expectancy_r ?? '—'} R</strong></div>
                      </div>
                      <div className={styles.reportSummary}>
                        <div><span>Gross profit</span><strong>{reportResult.gross_profit ?? '—'}</strong></div>
                        <div><span>Gross loss</span><strong>{reportResult.gross_loss ?? '—'}</strong></div>
                        <div><span>Total costs</span><strong>{reportResult.total_costs ?? '—'}</strong></div>
                        <div><span>Average R</span><strong>{reportResult.average_r ?? '—'}</strong></div>
                      </div>
                      <div className={styles.tradeHistory}>
                        <div className={styles.tradeHistoryHeader}><h4>Trade history</h4><span>{reportTrades.length} persisted trades</span></div>
                        {reportTrades.length === 0 ? <p className="muted">No simulated trades were produced by this completed run.</p> : (
                          <div className={styles.tradeRows}>
                            {reportTrades.map((trade) => (
                              <div key={trade.id} className={styles.tradeRow}>
                                <span>#{trade.sequence}</span><strong>{trade.direction}</strong><span>{formatDate(trade.entry_timestamp)}</span>
                                <span>Entry {trade.entry}</span><span>Exit {trade.exit_price ?? '—'}</span>
                                <span className={(trade.net_pnl ?? 0) >= 0 ? styles.positive : styles.negative}>P&amp;L {trade.net_pnl ?? '—'}</span>
                                <span>{trade.net_r ?? '—'} R</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {effectivePeriodEnd && selectedRun?.period_end && dataFreshnessSeconds > 60 && (
                        <div className={styles.reportNotice}>
                          <strong>Historical data coverage</strong>
                          <div>
                            Requested through {formatDate(selectedRun.period_end)}. Backtest used complete historical data through {formatDate(effectivePeriodEnd)}.
                            {' '}The newest {Math.max(1, Math.round(dataFreshnessSeconds / 3600))} hour(s) were excluded rather than blocking the run.
                          </div>
                        </div>
                      )}

                      {sampleQuality && (
                        <div className={styles.reportNotice}>
                          <strong>Sample quality: {String(sampleQuality.label ?? 'Unknown')}</strong>
                          <div>
                            {numberValue(reportResult.total_trades ?? reportTrades.length)} completed trade{numberValue(reportResult.total_trades ?? reportTrades.length) === 1 ? '' : 's'}.
                            {String(sampleQuality.code ?? '') !== 'MORE_INFORMATIVE'
                              ? ' This sample is too small to treat the performance metrics as a reliable conclusion.'
                              : ' The sample is large enough to be more informative, though historical performance still has limitations.'}
                          </div>
                        </div>
                      )}

                      {opportunityFunnel && (
                        <div style={{ marginTop: 20 }}>
                          <p className="eyebrow">OPPORTUNITY FUNNEL</p>
                          <div className={styles.reportMetrics}>
                            <div><small>Execution candles evaluated</small><strong>{numberValue(opportunityFunnel.execution_candles_evaluated).toLocaleString()}</strong></div>
                            <div><small>Multi-timeframe context ready</small><strong>{numberValue(opportunityFunnel.multi_timeframe_context_ready).toLocaleString()}</strong></div>
                            <div><small>Analysis completed</small><strong>{numberValue(opportunityFunnel.analysis_completed).toLocaleString()}</strong></div>
                            <div><small>READY candidate found</small><strong>{numberValue(opportunityFunnel.ready_candidate_found).toLocaleString()}</strong></div>
                            <div><small>Setup readiness READY</small><strong>{numberValue(opportunityFunnel.setup_readiness_ready).toLocaleString()}</strong></div>
                            <div><small>Direction allowed</small><strong>{numberValue(opportunityFunnel.direction_allowed).toLocaleString()}</strong></div>
                            <div><small>Daily limit allowed</small><strong>{numberValue(opportunityFunnel.daily_limit_allowed).toLocaleString()}</strong></div>
                            <div><small>Valid risk geometry</small><strong>{numberValue(opportunityFunnel.valid_risk_geometry).toLocaleString()}</strong></div>
                            <div><small>Executable signals</small><strong>{numberValue(opportunityFunnel.executable_signals).toLocaleString()}</strong></div>
                            <div><small>Completed trades</small><strong>{numberValue(opportunityFunnel.completed_trades).toLocaleString()}</strong></div>
                          </div>
                        </div>
                      )}

                      <small className="muted">Historical performance does not guarantee future results.</small>
                    </>
                  )}
                  {!reportResult && !reportLoading && !reportError && (
                    <div className="button-row" style={{ marginTop: 18 }}>
                      <button type="button" className="secondary" onClick={() => { void openRunReport(selectedRun); }}>Load Report</button>
                    </div>
                  )}
                </section>
          </div>
        </div>
      )}
            </div>
          )}

          {tab === 'forward-test' && (
            <section className="card strategy-detail-forward-card strategy-detail-view">
              <p className="eyebrow">FORWARD TEST</p>
              <h3>Forward Testing</h3>
              <p className="muted" style={{ marginTop: 12 }}>Coming soon</p>
              <p className="muted" style={{ marginTop: 12 }}>Validate your strategy against live market conditions before using it in execution.</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
