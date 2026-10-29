'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import styles from './StrategyShareDialog.module.css';

type ShareRecord = {
  id: string;
  shareCode: string;
  status: 'ACTIVE' | 'REVOKED';
  currentVersion: number;
  installCount: number;
};

function errorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as { error?: { message?: string } | string; message?: string };
  if (typeof value.error === 'string') return value.error;
  return value.error?.message || value.message || fallback;
}

export default function StrategyShareDialog({ strategyId, strategyName }: { strategyId: string; strategyName: string }) {
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<ShareRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [qr, setQr] = useState('');
  const shareUrl = share?.shareCode && typeof window !== 'undefined'
    ? `${window.location.origin}/share/strategy/${share.shareCode}`
    : '';

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetch(`/api/strategies/share?strategyId=${encodeURIComponent(strategyId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload, 'Could not load sharing.'));
        if (active) setShare(payload.share ?? null);
      })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'Could not load sharing.'); });
    return () => { active = false; };
  }, [open, strategyId]);

  useEffect(() => {
    if (!shareUrl || share?.status !== 'ACTIVE') return setQr('');
    let active = true;
    void import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(shareUrl, { width: 320, margin: 1, color: { dark: '#071019', light: '#f4fbff' } }))
      .then((value) => { if (active) setQr(value); })
      .catch(() => { if (active) setQr(''); });
    return () => { active = false; };
  }, [shareUrl, share?.status]);

  async function publish() {
    const wasActive = share?.status === 'ACTIVE';
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/strategies/share', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategyId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, 'Could not create the share link.'));
      setShare(payload.share);
      setMessage(wasActive ? 'The latest strategy version is ready to share.' : 'Private share link created.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create the share link.');
    } finally { setBusy(false); }
  }

  async function copyLink() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setMessage('Link copied.');
  }

  async function nativeShare() {
    if (!shareUrl) return;
    if (!navigator.share) return void copyLink();
    try {
      await navigator.share({ title: strategyName, text: `Review my ${strategyName} strategy in Trade Police.`, url: shareUrl });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage('Sharing is unavailable on this device. Copy the link instead.');
    }
  }

  async function revoke() {
    if (!share) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/strategies/share', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shareId: share.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, 'Could not revoke this link.'));
      setShare((current) => current ? { ...current, status: 'REVOKED' } : current);
      setMessage('Link revoked. Installed copies remain private and unchanged.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not revoke this link.');
    } finally { setBusy(false); }
  }

  return <>
    <button type="button" className="button-link secondary" onClick={() => setOpen(true)}>Share</button>
    {open && createPortal(
      <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="strategy-share-title">
          <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close sharing">×</button>
          <p className="eyebrow">PRIVATE STRATEGY SHARE</p>
          <h2 id="strategy-share-title">Share {strategyName}</h2>
          <p className="muted">Send a protected Trade Police link. The recipient reviews the strategy first, then chooses whether to add an inactive copy.</p>

          {share?.status === 'ACTIVE' ? <div className={styles.shareGrid}>
            <div className={styles.qrPanel}>{qr ? <img src={qr} alt={`QR code for ${strategyName}`} /> : <span>Preparing QR…</span>}</div>
            <div className={styles.shareDetails}>
              <div><span>Published version</span><strong>v{share.currentVersion}</strong></div>
              <div><span>People who installed</span><strong>{share.installCount}</strong></div>
              <label><span>Private link</span><input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} /></label>
              <div className={styles.actions}>
                <button type="button" className="primary" onClick={() => void nativeShare()}>Share link</button>
                <button type="button" className="secondary" onClick={() => void copyLink()}>Copy</button>
              </div>
            </div>
          </div> : <div className={styles.emptyShare}>
            <strong>{share ? 'This link is revoked.' : 'No share link yet.'}</strong>
            <p className="muted">Publishing freezes the current version. Future changes create a new version; installed copies are never changed automatically.</p>
            <button type="button" className="primary" disabled={busy} onClick={() => void publish()}>{busy ? 'Publishing…' : share ? 'Publish a new version' : 'Create private share link'}</button>
          </div>}

          <div className={styles.license}>
            <strong>Personal-use license</strong>
            <p>The creator keeps ownership. Installing grants personal use inside Trade Police—not permission to resell, republish, or claim authorship.</p>
          </div>
          {share?.status === 'ACTIVE' ? <div className={styles.footerRow}>
            <button type="button" className="secondary" disabled={busy} onClick={() => void publish()}>{busy ? 'Updating…' : 'Publish latest version'}</button>
            <button type="button" className={styles.revoke} disabled={busy} onClick={() => void revoke()}>Revoke link</button>
          </div> : null}
          {message ? <p className={styles.message} role="status">{message}</p> : null}
        </section>
      </div>, document.body)}
  </>;
}
