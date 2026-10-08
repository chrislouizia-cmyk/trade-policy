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

type ModalState =
  | {
      mode: 'confirm';
      affiliate: Affiliate;
      decision: Decision;
    }
  | {
      mode: 'success';
      affiliate: Affiliate;
      decision: Decision;
    }
  | {
      mode: 'error';
      affiliate: Affiliate;
      decision: Decision;
      message: string;
    }
  | null;

function decisionLabel(decision: Decision) {
  switch (decision) {
    case 'APPROVE':
      return 'Approve affiliate';
    case 'REJECT':
      return 'Reject application';
    case 'SUSPEND':
      return 'Suspend affiliate';
    case 'REACTIVATE':
      return 'Reactivate affiliate';
  }
}

function confirmationTitle(decision: Decision) {
  switch (decision) {
    case 'APPROVE':
      return 'Approve this affiliate?';
    case 'REJECT':
      return 'Reject this application?';
    case 'SUSPEND':
      return 'Suspend this affiliate?';
    case 'REACTIVATE':
      return 'Reactivate this affiliate?';
  }
}

function successTitle(decision: Decision) {
  switch (decision) {
    case 'APPROVE':
      return 'Affiliate approved';
    case 'REJECT':
      return 'Application rejected';
    case 'SUSPEND':
      return 'Affiliate suspended';
    case 'REACTIVATE':
      return 'Affiliate reactivated';
  }
}

function decisionReason(decision: Decision) {
  return `Affiliate ${decision.toLowerCase()} action completed from Trade Police HQ.`;
}

export default function AffiliateQueue() {
  const [rows, setRows] = useState<Affiliate[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState<ModalState>(null);

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
      setLoadError(
        cause instanceof Error
          ? cause.message
          : 'Affiliate queue failed to load.'
      )
    );
  }, [load]);

  async function submitReview() {
    if (!modal || modal.mode !== 'confirm') return;

    const { affiliate, decision } = modal;

    setBusy(true);

    try {
      const response = await fetch('/api/hq/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliateId: affiliate.id,
          decision,
          reason: decisionReason(decision),
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body?.error?.message ?? 'Affiliate review failed.'
        );
      }

      await load();

      setModal({
        mode: 'success',
        affiliate,
        decision,
      });
    } catch (cause) {
      setModal({
        mode: 'error',
        affiliate,
        decision,
        message:
          cause instanceof Error
            ? cause.message
            : 'Affiliate review failed.',
      });
    } finally {
      setBusy(false);
    }
  }

  function openReview(affiliate: Affiliate, decision: Decision) {
    setModal({
      mode: 'confirm',
      affiliate,
      decision,
    });
  }

  return (
    <>
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

        {loadError && <p className="error">{loadError}</p>}

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
                    onClick={() => openReview(row, 'APPROVE')}
                  >
                    Approve
                  </button>

                  <button
                    className="secondary"
                    type="button"
                    onClick={() => openReview(row, 'REJECT')}
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
                    onClick={() => openReview(row, 'SUSPEND')}
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
                    onClick={() => openReview(row, 'REACTIVATE')}
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

      {modal && (
        <div
          className="affiliate-review-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !busy
            ) {
              setModal(null);
            }
          }}
        >
          <section
            className="affiliate-review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="affiliate-review-title"
          >
            <button
              className="affiliate-review-close"
              type="button"
              aria-label="Close"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              ×
            </button>

            {modal.mode === 'confirm' && (
              <>
                <div className="affiliate-review-icon">
                  ◎
                </div>

                <span className="eyebrow">AFFILIATE CONTROL</span>

                <h2 id="affiliate-review-title">
                  {confirmationTitle(modal.decision)}
                </h2>

                <p className="muted">
                  Review the application details before continuing.
                </p>

                <div className="affiliate-review-details">
                  <div>
                    <span>Email</span>
                    <strong>
                      {modal.affiliate.email ||
                        modal.affiliate.user_id}
                    </strong>
                  </div>

                  <div>
                    <span>Referral code</span>
                    <strong>
                      {modal.affiliate.referral_code}
                    </strong>
                  </div>

                  <div>
                    <span>Applied</span>
                    <strong>
                      {new Date(
                        modal.affiliate.created_at
                      ).toLocaleString()}
                    </strong>
                  </div>
                </div>

                {modal.decision === 'APPROVE' && (
                  <p className="affiliate-review-explanation">
                    This will grant access to the Affiliate Program.
                    The affiliate will be able to share their referral
                    link and begin earning eligible commissions.
                  </p>
                )}

                <div className="affiliate-review-actions">
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>

                  <button
                    className="primary"
                    type="button"
                    disabled={busy}
                    onClick={submitReview}
                  >
                    {busy
                      ? 'Processing…'
                      : decisionLabel(modal.decision)}
                  </button>
                </div>
              </>
            )}

            {modal.mode === 'success' && (
              <>
                <div className="affiliate-review-success-icon">
                  ✓
                </div>

                <h2 id="affiliate-review-title">
                  {successTitle(modal.decision)}
                </h2>

                <p className="muted">
                  The Affiliate Program status was updated successfully.
                </p>

                <div className="affiliate-review-details">
                  <div>
                    <span>Email</span>
                    <strong>
                      {modal.affiliate.email ||
                        modal.affiliate.user_id}
                    </strong>
                  </div>

                  <div>
                    <span>Referral code</span>
                    <strong>
                      {modal.affiliate.referral_code}
                    </strong>
                  </div>

                  <div>
                    <span>Status</span>
                    <strong>
                      {modal.decision === 'APPROVE' ||
                      modal.decision === 'REACTIVATE'
                        ? 'APPROVED'
                        : modal.decision === 'SUSPEND'
                          ? 'SUSPENDED'
                          : 'REJECTED'}
                    </strong>
                  </div>
                </div>

                <button
                  className="primary affiliate-review-done"
                  type="button"
                  onClick={() => setModal(null)}
                >
                  Done
                </button>
              </>
            )}

            {modal.mode === 'error' && (
              <>
                <div className="affiliate-review-error-icon">
                  !
                </div>

                <h2 id="affiliate-review-title">
                  We couldn’t update this affiliate
                </h2>

                <p className="muted">
                  No completed status change was confirmed.
                </p>

                <div className="affiliate-review-error-message">
                  {modal.message}
                </div>

                <div className="affiliate-review-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setModal(null)}
                  >
                    Close
                  </button>

                  <button
                    className="primary"
                    type="button"
                    onClick={() =>
                      setModal({
                        mode: 'confirm',
                        affiliate: modal.affiliate,
                        decision: modal.decision,
                      })
                    }
                  >
                    Try again
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
