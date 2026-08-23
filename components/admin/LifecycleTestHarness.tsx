'use client';

import { useMemo, useState, type CSSProperties } from 'react';

type TradingAccountOption = {
  id: string;
  name: string;
  currency: string;
  accountType: string;
  currentBalance: number;
  isActive: boolean;
  isArchived: boolean;
};

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

type ScenarioKey = 'READY' | 'SOFT_BLOCK' | 'HARD_BLOCK';

type SeedResponse = {
  sourceDecisionId: string;
  sourceReportId: string;
  authoritativeVerdict: 'READY' | 'BLOCKED';
  overrideEligible: boolean;
};

type PayloadState = {
  scenario: ScenarioKey;
  instrument: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskPercent: number;
  overrideReason: string;
  sourceDecisionId: string;
  sourceReportId: string;
  authoritativeVerdict: 'READY' | 'BLOCKED';
  overrideEligible: boolean;
};

const basePayload = (): PayloadState => ({
  scenario: 'READY',
  instrument: 'XAUUSD',
  direction: 'BUY',
  entry: 2348.5,
  stopLoss: 2338.4,
  takeProfit: 2375.8,
  riskPercent: 0.5,
  overrideReason: 'Internal lifecycle smoke test override',
  sourceDecisionId: '',
  sourceReportId: '',
  authoritativeVerdict: 'READY',
  overrideEligible: false,
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

async function seedLifecycleLineage(payload: Pick<PayloadState, 'scenario' | 'instrument' | 'direction' | 'entry' | 'stopLoss' | 'takeProfit' | 'riskPercent'>): Promise<SeedResponse> {
  const response = await fetch('/api/internal/lifecycle-test/seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'Unable to seed internal lifecycle lineage.';
    throw new Error(message);
  }

  return data as SeedResponse;
}

export default function LifecycleTestHarness({ role, accounts }: { role: string; accounts: TradingAccountOption[] }) {
  const defaultAccountId = useMemo(
    () => accounts.find((account) => account.isActive)?.id ?? accounts[0]?.id ?? '',
    [accounts],
  );

  const [payload, setPayload] = useState<PayloadState>(basePayload);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(defaultAccountId);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [closeResult, setCloseResult] = useState<ApiResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  const updateField = <K extends keyof PayloadState>(field: K, value: PayloadState[K]) => {
    setPayload((current) => ({ ...current, [field]: value }));
  };

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? accounts[0] ?? null;

  const runSimulation = async () => {
    setError(null);
    setResult(null);
    setCloseResult(null);
    setBusy(true);

    try {
      const seeded = await seedLifecycleLineage({
        scenario: payload.scenario,
        instrument: payload.instrument,
        direction: payload.direction,
        entry: Number(payload.entry),
        stopLoss: Number(payload.stopLoss),
        takeProfit: Number(payload.takeProfit),
        riskPercent: Number(payload.riskPercent),
      });

      setPayload((current) => ({
        ...current,
        sourceDecisionId: seeded.sourceDecisionId,
        sourceReportId: seeded.sourceReportId,
        authoritativeVerdict: seeded.authoritativeVerdict,
        overrideEligible: seeded.overrideEligible,
      }));

      const activationMode = payload.scenario === 'SOFT_BLOCK' ? 'OVERRIDE' : 'READY';
      const overrideReason = payload.scenario === 'SOFT_BLOCK' ? payload.overrideReason.trim() : null;
      if (payload.scenario === 'SOFT_BLOCK' && !overrideReason) {
        throw new Error('Soft-block simulations require a non-empty override reason.');
      }
      if (!selectedAccountId || !selectedAccount) {
        throw new Error('No active trading account is available for Lifecycle V2 simulation.');
      }

      const requestBody = {
        accountId: selectedAccountId,
        sourceDecisionId: seeded.sourceDecisionId,
        sourceReportId: seeded.sourceReportId,
        instrument: payload.instrument,
        direction: payload.direction,
        entry: Number(payload.entry),
        stopLoss: Number(payload.stopLoss),
        takeProfit: Number(payload.takeProfit),
        riskPercent: Number(payload.riskPercent),
        activationMode,
        overrideReason,
        originalVerdict: seeded.authoritativeVerdict,
        takenAgainstVerdict: false,
        highImpactNews: false,
        strategySnapshot: { source: 'INTERNAL_SMOKE_TEST', simulationMode: 'INTERNAL_LIFECYCLE_SMOKE_TEST' },
      };

      try {
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
        if (payload.scenario === 'HARD_BLOCK') {
          setError(`PASS — activation correctly rejected: ${text}`);
          return;
        }
        throw caughtError;
      }
    } catch (caughtError) {
      const text = caughtError instanceof Error ? caughtError.message : 'Unknown lifecycle error.';
      setError(text);
    } finally {
      setBusy(false);
    }
  };

  const showOverrideReason = payload.scenario === 'SOFT_BLOCK';

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
          This lab seeds a real internal Decision Report lineage server-side before exercising the V2 activation route.
        </p>

        {!accounts.length ? (
          <div style={{ marginTop: 20, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(127,29,29,0.26)', color: '#fecaca', padding: '12px 14px', borderRadius: 12 }}>
            No active trading account is available for Lifecycle V2 simulation.
          </div>
        ) : (
          <label style={{ display: 'grid', gap: 6, marginTop: 20 }}>
            <span>account</span>
            <select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)} style={inputStyle}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.currency} {account.currentBalance.toLocaleString()} · {account.isActive ? 'ACTIVE' : 'INACTIVE'} · {account.accountType}
                </option>
              ))}
            </select>
          </label>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 20 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>scenario</span>
            <select value={payload.scenario} onChange={(event) => updateField('scenario', event.target.value as ScenarioKey)} style={inputStyle}>
              <option value="READY">READY</option>
              <option value="SOFT_BLOCK">SOFT BLOCK</option>
              <option value="HARD_BLOCK">HARD BLOCK</option>
            </select>
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
        </div>

        {showOverrideReason && (
          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>override reason</span>
              <input value={payload.overrideReason} onChange={(event) => updateField('overrideReason', event.target.value)} style={inputStyle} />
            </label>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 20, flexWrap: 'wrap' }}>
          <button onClick={runSimulation} disabled={busy || !selectedAccountId} style={buttonStyle('#1d4ed8')}>
            {busy ? 'Running simulation…' : 'Run Simulation'}
          </button>
          <div style={{ fontSize: 12, color: '#cbd5e1' }}>
            {selectedAccount ? `${selectedAccount.name} · ${selectedAccount.currency} ${selectedAccount.currentBalance.toLocaleString()} · ${selectedAccount.isActive ? 'ACTIVE' : 'INACTIVE'}` : 'No account selected'}
          </div>
          <div style={{ fontSize: 12, color: '#cbd5e1' }}>
            {payload.authoritativeVerdict} · overrideEligible {String(payload.overrideEligible)}
          </div>
        </div>

        <details open={showAdvanced} onToggle={(event) => setShowAdvanced((event.target as HTMLDetailsElement).open)} style={{ marginTop: 20, border: '1px solid rgba(148,163,184,0.25)', borderRadius: 12, padding: 12 }}>
          <summary style={{ cursor: 'pointer', color: '#e2e8f0', fontWeight: 600 }}>Advanced / Debug</summary>
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 12, color: '#cbd5e1' }}><strong>sourceDecisionId:</strong> {payload.sourceDecisionId || 'not seeded yet'}</div>
            <div style={{ fontSize: 12, color: '#cbd5e1' }}><strong>sourceReportId:</strong> {payload.sourceReportId || 'not seeded yet'}</div>
            <div style={{ fontSize: 12, color: '#cbd5e1' }}><strong>authoritativeVerdict:</strong> {payload.authoritativeVerdict}</div>
            <div style={{ fontSize: 12, color: '#cbd5e1' }}><strong>overrideEligible:</strong> {String(payload.overrideEligible)}</div>
          </div>
        </details>

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
