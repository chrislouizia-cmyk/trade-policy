'use client';

import { useCallback, useEffect, useState } from 'react';

type Affiliate = {
  id: string;
  user_id: string;
  email: string | null;
  status: string;
  referral_code: string;
  created_at: string;
  clicks: number;
  signups: number;
  paying_customers: number;
};

type Decision = 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REACTIVATE';

export default function AffiliateQueue() {
  const [rows, setRows] = useState<Affiliate[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/hq/affiliates', {
      cache: 'no-store',
    });

    const body = await response.json();

    if (!response.ok) {
      throw new Error(
        body?.error?.message ?? 'Affiliate queue failed to load.'
      );
    }

    setRows(body.items ?? []);
  }, []);

  useEffect(() => {
    void load().catch((cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : 'Affiliate queue failed to load.'
      )
    );
  }, [load]);

  async function review(
    affiliateId: string,
    decision: Decision
  ) {
    if (
      !window.confirm(
        `${decision.toLowerCase()} this affiliate?`
      )
    ) {
      return;
    }

    setBusyId(affiliateId);
    setError('');

    try {
      const response = await fetch('/api/hq/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliateId,
          decision,
          reason: `Affiliate ${decision.toLowerCase()}d from Trade Police HQ.`,
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body?.error?.message ?? 'Affiliate review failed.'
        );
      }

      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Affiliate review failed.'
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card">
      <div className="section-title">
        <div>
          <span className="eyebrow">AFFILIATE CONTROL</span>
          <h2>Affiliate applications</h2>
        </div>

        <span className="status-pill info">
          {rows.filter((row) => row.status === 'PENDING').length} pending
        </span>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="stack">
        {rows.map((row) => (
          <div className="card" key={row.id}>
            <div className="section-title">
              <div>
                <strong>{row.email || row.user_id}</strong>
                <p className="muted">
                  {row.referral_code} · Applied{' '}
                  {new Date(row.created_at).toLocaleString()}
                </p>
              </div>

              <span className="status-pill info">
                {row.status}
              </span>
            </div>

            <div className="grid grid-3">
              <div>
                <small>Clicks</small>
                <strong>{row.clicks}</strong>
              </div>

              <div>
                <small>Signups</small>
                <strong>{row.signups}</strong>
              </div>

              <div>
                <small>Paying customers</small>
                <strong>{row.paying_customers}</strong>
              </div>
            </div>

            {row.status === 'PENDING' && (
              <div className="button-row">
                <button
                  className="primary"
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => review(row.id, 'APPROVE')}
                >
                  Approve
                </button>

                <button
                  className="secondary"
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => review(row.id, 'REJECT')}
                >
                  Reject
                </button>
              </div>
            )}

            {row.status === 'APPROVED' && (
              <div className="button-row">
                <button
                  className="secondary"
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => review(row.id, 'SUSPEND')}
                >
                  Suspend
                </button>
              </div>
            )}

            {(row.status === 'SUSPENDED' ||
              row.status === 'PAUSED') && (
              <div className="button-row">
                <button
                  className="primary"
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => review(row.id, 'REACTIVATE')}
                >
                  Reactivate
                </button>
              </div>
            )}
          </div>
        ))}

        {rows.length === 0 && (
          <p className="muted">No affiliate applications yet.</p>
        )}
      </div>
    </section>
  );
}
