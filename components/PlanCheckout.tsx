'use client';

import { useState } from 'react';
import { apiErrorMessage, readApiResponse, redirectExpiredSession } from '@/lib/api-error';
import { trackBetaEvent } from '@/lib/beta-intelligence';

type PlanCode = 'PRO' | 'ELITE' | 'TEAM';
type BillingInterval = 'monthly' | 'annual';

export default function PlanCheckout({ plan }: { plan: PlanCode }) {
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    void trackBetaEvent('UPGRADE_INITIATED');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      });

      const data = await readApiResponse(response);
      if (redirectExpiredSession(response, '/account')) return;
      if (!response.ok) {
        throw new Error(apiErrorMessage(data, 'Billing is temporarily unavailable. No charge was made.'));
      }

      if (!data || typeof data !== 'object' || typeof (data as { url?: unknown }).url !== 'string') {
        throw new Error('Billing returned an invalid response. No charge was made.');
      }

      window.location.assign((data as { url: string }).url);
    } catch (value) {
      setError(
        value instanceof Error && value.name === 'AbortError'
          ? 'Billing took too long to respond. No charge was made.'
          : value instanceof Error
            ? value.message
            : 'Billing is temporarily unavailable. No charge was made.',
      );
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  return (
    <div className="checkout-picker">
      <div className="segmented-control" aria-label={`${plan} billing interval`}>
        <button
          type="button"
          className={interval === 'monthly' ? 'secondary selected' : 'secondary'}
          onClick={() => setInterval('monthly')}
        >
          Monthly
        </button>
        <button
          type="button"
          className={interval === 'annual' ? 'secondary selected' : 'secondary'}
          onClick={() => setInterval('annual')}
        >
          Annual
        </button>
      </div>
      <button className="primary" type="button" disabled={busy} onClick={submit}>
        {busy ? 'Opening…' : `Upgrade to ${plan}`}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
