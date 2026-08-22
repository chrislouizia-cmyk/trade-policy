'use client';

import { useMemo, useState, type CSSProperties } from 'react';

type ApiResult = Record<string, unknown> & {
  trade_record_id?: string | null;
  active_trade_id?: string | null;
  lifecycle_status?: string | null;
  status?: string | null;
  duplicate?: boolean;
  already_closed?: boolean;
  result_r?: number | null;
  realized_pnl?: number | null;
  outcome?: string | null;
};

type PayloadState = {
  sourceDecisionId: string;
  sourceReportId: string;
  instrument: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskPercent: number;
  activationMode: 'READY' | 'OVERRIDE';
  overrideReason: string;
  originalVerdict: string;
  takenAgainstVerdict: boolean;
  highImpactNews: boolean;
};

const basePayload = (): PayloadState => ({
  sourceDecisionId: '',
  sourceReportId: '',
  instrument: 'XAUUSD',
  direction: 'BUY',
  entry: 2348.5,
  stopLoss: 2338.4,
  takeProfit: 2375.8,
  riskPercent: 0.5,
  activationMode: 'READY',
  overrideReason: 'Internal lifecycle smoke test override',
  originalVerdict: '',
  takenAgainstVerdict: false,
  highImpactNews: false,
});

async function postSimulationRequest(path: string, body: Record<string, unknown>) {
  const qs = new URLSearchParams({ internal_test: '1' });
  const response = await fetch(`${path}?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'Request failed.';
    throw new Error(message);
  }

  return data?.result ?? data;
}

export default function LifecycleTestHarness({ role }: { role: string }) {
  const [payload, setPayload] = useState<PayloadState>(basePayload);
  const [busy, setBusy] = useState<'activate' | 'close' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [closeResult, setCloseResult] = useState<ApiResult | null>(null);

  const canUseOverride = useMemo(() => payload.activationMode === 'OVERRIDE', [payload.activationMode]);

  const updateField = <K extends keyof PayloadState>(field: K, value: PayloadState[K]) => {
    setPayload((current) => ({ ...current, [field]: value }));
  };

  const runScenario = async (mode: 'READY' | 'SOFT_BLOCK' | 'HARD_BLOCK') => {
    setError(null);
    setResult(null);
    setCloseResult(null);
    setBusy('activate');

    try {
      const seedDecisionId = payload.sourceDecisionId || crypto.randomUUID();
      const seedReportId = payload.sourceReportId || crypto.randomUUID();
      const activationMode = mode === 'READY' ? 'READY' : mode === 'SOFT_BLOCK' ? 'OVERRIDE' : 'READY';
      const originalVerdict = mode === 'HARD_BLOCK' ? 'BLOCKED' : mode === 'SOFT_BLOCK' ? 'BLOCKED' : 'READY';
      const overrideReason = mode === 'SOFT_BLOCK' ? payload.overrideReason || 'Internal lifecycle smoke test override' : null;

      const requestBody = {
        sourceDecisionId: seedDecisionId,
        sourceReportId: seedReportId,
        instrument: payload.instrument,
        direction: payload.direction,
        entry: Number(payload.entry),
        stopLoss: Number(payload.stopLoss),
        takeProfit: Number(payload.takeProfit),
        riskPercent: Number(payload.riskPercent),
        activationMode,
        overrideReason,
        originalVerdict,
        takenAgainstVerdict: payload.takenAgainstVerdict,
        highImpactNews: payload.highImpactNews,
        strategySnapshot: { source: 'INTERNAL_SMOKE_TEST', simulationMode: 'INTERNAL_LIFECYCLE_SMOKE_TEST' },
      };

      const nextResult = await postSimulationRequest('/api/trades/activate', requestBody);
      setResult(nextResult as ApiResult);

      if (nextResult?.active_trade_id) {
        const closePrice = payload.direction === 'BUY' ? Number(payload.entry) + 12 : Number(payload.entry) - 12;
        const closeResponse = await postSimulationRequest(`/api/trades/${nextResult.active_trade_id}/close`, {
          closePrice,
          fees: 0,
          notes: 'Internal lifecycle smoke test close',
          outcome: 'BREAKEVEN',
        });
        setCloseResult(closeResponse as ApiResult);
      }
    } catch (caughtError) {
      const text = caughtError instanceof Error ? caughtError.message : 'Unknown lifecycle error.';
      setError(text);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main style={{ maxWidth: 1100, margin: '32px auto', padding: '0 16px', color: '#e5eefb' }}>
      <div style={{ border: '1px solid rgba(148,163,184,0.35)', borderRadius: 16, padding: 20, background: '#0b1220' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div>
            <div style={{ textTransform: 'uppercase', letterSpacing: '0.12em', color: '#7dd3fc', fontSize: 12, fontWeight: 700 }}>
              Internal only
            </div>
            <h1 style={{ margin: '8px 0 0', fontSize: 28 }}>Lifecycle V2 smoke harness</h1>
          </div>
          <div style={{ fontSize: 12, color: '#cbd5e1', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 999, padding: '6px 10px' }}>
            role: {role}
          </div>
        </div>

        <p style={{ marginTop: 0, color: '#cbd5e1', lineHeight: 1.6 }}>
          This page only runs when the server-side simulation flag is enabled. It exercises the real V2 activation and close routes while keeping the trade explicitly marked as internal simulation metadata so it never counts as a live execution.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 20 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>sourceDecisionId</span>
            <input value={payload.sourceDecisionId} onChange={(event) => updateField('sourceDecisionId', event.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>sourceReportId</span>
            <input value={payload.sourceReportId} onChange={(event) => updateField('sourceReportId', event.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>instrument</span>
            <input value={payload.instrument} onChange={(event) => updateField('instrument', event.target.value.toUpperCase())} style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>direction</span>
            <select value={payload.direction} onChange={(event) => updateField('direction', event.target.value as 'BUY' | 'SELL')} style={inputStyle}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>entry</span>
            <input type="number" step="0.01" value={payload.entry} onChange={(event) => updateField('entry', Number(event.target.value))} style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>stopLoss</span>
            <input type="number" step="0.01" value={payload.stopLoss} onChange={(event) => updateField('stopLoss', Number(event.target.value))} style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>takeProfit</span>
            <input type="number" step="0.01" value={payload.takeProfit} onChange={(event) => updateField('takeProfit', Number(event.target.value))} style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>riskPercent</span>
            <input type="number" step="0.01" value={payload.riskPercent} onChange={(event) => updateField('riskPercent', Number(event.target.value))} style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>activation mode</span>
            <select value={payload.activationMode} onChange={(event) => updateField('activationMode', event.target.value as 'READY' | 'OVERRIDE')} style={inputStyle}>
              <option value="READY">READY</option>
              <option value="OVERRIDE">OVERRIDE</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>original verdict</span>
            <input value={payload.originalVerdict} onChange={(event) => updateField('originalVerdict', event.target.value.toUpperCase())} placeholder="READY or BLOCKED" style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
            <span>override reason</span>
            <input value={payload.overrideReason} onChange={(event) => updateField('overrideReason', event.target.value)} disabled={!canUseOverride} style={{ ...inputStyle, opacity: canUseOverride ? 1 : 0.55 }} />
          </label>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
          <button onClick={() => runScenario('READY')} disabled={busy === 'activate'} style={buttonStyle('#1d4ed8')}>
            {busy === 'activate' ? 'Running ready activation…' : 'Simulate READY'}
          </button>
          <button onClick={() => runScenario('SOFT_BLOCK')} disabled={busy === 'activate'} style={buttonStyle('#f59e0b')}>
            Simulate SOFT BLOCK
          </button>
          <button onClick={() => runScenario('HARD_BLOCK')} disabled={busy === 'activate'} style={buttonStyle('#ef4444')}>
            Simulate HARD BLOCK
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 18, border: '1px solid rgba(239,68,68,0.6)', background: 'rgba(127,29,29,0.25)', color: '#fecaca', borderRadius: 12, padding: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18, marginTop: 24 }}>
          <ResultCard title="Activation result" data={result} />
          <ResultCard title="Close result" data={closeResult} />
        </div>
      </div>
    </main>
  );
}

function ResultCard({ title, data }: { title: string; data: ApiResult | null }) {
  if (!data) {
    return (
      <div style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        <p style={{ color: '#94a3b8', margin: 0 }}>No result yet.</p>
      </div>
    );
  }

  const rows = [
    ['lifecycle_status', data.lifecycle_status ?? data.status ?? '—'],
    ['active_trade_id', data.active_trade_id ?? '—'],
    ['trade_record_id', data.trade_record_id ?? '—'],
    ['duplicate', typeof data.duplicate === 'boolean' ? String(data.duplicate) : '—'],
    ['already_closed', typeof data.already_closed === 'boolean' ? String(data.already_closed) : '—'],
    ['outcome', data.outcome ?? '—'],
    ['result_r', data.result_r ?? '—'],
    ['realized_pnl', data.realized_pnl ?? '—'],
  ];

  return (
    <div style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <dl style={{ margin: 0, display: 'grid', gap: 6 }}>
        {rows.map(([key, value]) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid rgba(148,163,184,0.15)', paddingBottom: 6 }}>
            <dt style={{ color: '#94a3b8' }}>{key}</dt>
            <dd style={{ margin: 0, color: '#e2e8f0', textAlign: 'right' }}>{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const inputStyle: CSSProperties = {
  border: '1px solid rgba(148,163,184,0.3)',
  borderRadius: 10,
  background: '#0f172a',
  color: '#e2e8f0',
  padding: '10px 12px',
  fontSize: 14,
};

const buttonStyle = (color: string): CSSProperties => ({
  border: 'none',
  borderRadius: 10,
  background: color,
  color: '#fff',
  padding: '10px 16px',
  fontWeight: 700,
  cursor: 'pointer',
});

const cardStyle: CSSProperties = {
  border: '1px solid rgba(148,163,184,0.3)',
  borderRadius: 14,
  background: '#0b1220',
  padding: 16,
};
