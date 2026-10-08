'use client';

import { useCallback, useEffect, useState } from 'react';

type Row = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  status: string;
  applied_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  is_beta_tester: boolean;
};

export default function PrivateBetaQueue() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/hq/private-beta', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message ?? 'Queue failed to load.');
    setRows(body.items ?? []);
  }, []);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : 'Queue failed to load.')); }, [load]);

  async function review(userId: string, decision: 'APPROVE' | 'REJECT') {
    setBusyId(userId);
    setError('');
    try {
      const response = await fetch('/api/hq/private-beta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, decision }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Review failed.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card">
      <div className="section-title">
        <div>
          <span className="eyebrow">ACCESS QUEUE</span>
          <h2>Private Beta applications</h2>
        </div>
        <span className="status-pill info">{rows.length} applications</span>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="stack">
        {rows.map((row) => (
          <div className="card" key={row.user_id}>
            <div className="section-title">
              <div>
                <strong>{row.display_name || row.email || row.user_id}</strong>
                <p className="muted">{row.email}</p>
              </div>
              <span className="status-pill info">{row.status}</span>
            </div>
            <small>Applied {new Date(row.applied_at).toLocaleString()}</small>
            {(row.status === 'PENDING' || row.status === 'WAITLISTED') && (
              <div className="button-row">
                <button className="primary" type="button" disabled={busyId === row.user_id} onClick={() => review(row.user_id, 'APPROVE')}>Approve</button>
                <button className="secondary" type="button" disabled={busyId === row.user_id} onClick={() => review(row.user_id, 'REJECT')}>Reject</button>
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="muted">No Private Beta applications yet.</p>}
      </div>
    </section>
  );
}
