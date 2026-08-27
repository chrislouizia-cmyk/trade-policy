'use client';

import { useEffect, useState } from 'react';

type Status = {
  status: 'PENDING' | 'APPROVED' | 'WAITLISTED' | 'REJECTED' | null;
  is_beta_tester: boolean;
  plan_code: string;
  approved_count: number;
  capacity: number;
  spots_remaining: number;
};

export default function PrivateBetaCard() {
  const [state, setState] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const response = await fetch('/api/private-beta', { cache: 'no-store' });
    if (!response.ok) return;
    setState(await response.json());
  }

  useEffect(() => { void load(); }, []);

  async function apply() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/private-beta', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Application failed.');
      setState(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Application failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!state || !['FREE', 'PRIVATE_BETA'].includes(String(state.plan_code))) return null;

  const copy = state.status === 'APPROVED'
    ? ['Private Beta active', 'You have 10 backtests per month while your Private Beta access is active.']
    : state.status === 'PENDING'
      ? ['Application under review', 'HQ will review your Private Beta application.']
      : state.status === 'WAITLISTED'
        ? ['Private Beta waitlist', 'The 1,000-member Private Beta is full. Your place is saved on the waitlist.']
        : state.status === 'REJECTED'
          ? ['Application reviewed', 'Your current account remains on the FREE plan with one lifetime backtest.']
          : ['Apply for Private Beta', 'FREE includes one lifetime backtest. Private Beta includes 10 backtests per month.'];

  return (
    <section className="card">
      <div className="section-title">
        <div>
          <span className="eyebrow">BACKTEST ACCESS</span>
          <h2>{copy[0]}</h2>
        </div>
        {state.status && <span className="status-pill info">{state.status}</span>}
      </div>
      <p className="muted">{copy[1]}</p>
      {!state.status && (
        <div className="button-row">
          <button className="primary" type="button" onClick={apply} disabled={busy}>
            {busy ? 'Submitting…' : 'Apply for Private Beta'}
          </button>
        </div>
      )}
      {state.status === 'WAITLISTED' && <small>{state.spots_remaining} spots currently available.</small>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
