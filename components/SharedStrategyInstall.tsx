'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import styles from './SharedStrategyInstall.module.css';

type SharedPreview = {
  creatorName: string;
  isOwner: boolean;
  currentVersion: number;
  installedVersion: number | null;
  installedStrategyId: string | null;
  alreadyInstalled: boolean;
  updateAvailable: boolean;
  strategy: {
    name: string;
    description: string;
    instruments: string[];
    timeframes: Array<string | null>;
    maximumRiskPercent: number | null;
    minimumRR: number | null;
    ruleCount: number;
    sessionCount: number;
  };
};

function message(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as { error?: { message?: string } | string; message?: string };
  if (typeof value.error === 'string') return value.error;
  return value.error?.message || value.message || fallback;
}

export default function SharedStrategyInstall({ code }: { code: string }) {
  const [share, setShare] = useState<SharedPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/strategy-shares/${encodeURIComponent(code)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, 'This shared strategy is unavailable.'));
      setShare(payload.share);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This shared strategy is unavailable.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [code]);

  async function install() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/strategy-shares/${encodeURIComponent(code)}`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, 'Could not install this strategy.'));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not install this strategy.');
    } finally { setBusy(false); }
  }

  if (loading) return <section className={`card ${styles.stateCard}`}><p>Opening protected strategy…</p></section>;
  if (error && !share) return <section className={`card ${styles.stateCard}`}><h1>Share unavailable</h1><p className="muted">{error}</p><Link className="button-link secondary" href="/profile">Go to My Strategies</Link></section>;
  if (!share) return null;

  const timeframes = share.strategy.timeframes.filter(Boolean).join(' · ') || 'Not specified';
  const actionLabel = share.updateAvailable ? `Update my copy to v${share.currentVersion}` : share.alreadyInstalled ? 'Already in My Strategies' : 'Add to My Strategies';

  return <div className={styles.shell}>
    <section className={`card ${styles.hero}`}>
      <div>
        <p className="eyebrow">SHARED BY {share.creatorName.toUpperCase()} · VERSION {share.currentVersion}</p>
        <h1>{share.strategy.name}</h1>
        <p className={styles.description}>{share.strategy.description || 'A Trade Police member shared this strategy with you.'}</p>
      </div>
      <span className={styles.privateBadge}>PRIVATE SHARE</span>
    </section>

    <section className={`card ${styles.review}`}>
      <div className={styles.heading}><div><p className="eyebrow">REVIEW BEFORE INSTALLING</p><h2>What this strategy uses</h2></div><strong>Nothing activates automatically</strong></div>
      <div className={styles.metrics}>
        <div><span>Instruments</span><strong>{share.strategy.instruments.join(', ') || '—'}</strong></div>
        <div><span>Timeframes</span><strong>{timeframes}</strong></div>
        <div><span>Risk per trade</span><strong>{share.strategy.maximumRiskPercent ?? '—'}%</strong></div>
        <div><span>Minimum R:R</span><strong>{share.strategy.minimumRR ?? '—'}</strong></div>
        <div><span>Rules</span><strong>{share.strategy.ruleCount}</strong></div>
        <div><span>Sessions</span><strong>{share.strategy.sessionCount}</strong></div>
      </div>
    </section>

    <section className={`card ${styles.license}`}>
      <p className="eyebrow">PERSONAL-USE LICENSE</p>
      <h2>The creator keeps ownership.</h2>
      <p>You receive a private copy to use and adapt inside your account. You may not resell, republish, or claim the original strategy as your work. New versions are shown to you and never overwrite your copy without your confirmation.</p>
    </section>

    <section className={styles.actionBar}>
      <div><strong>{share.updateAvailable ? 'A newer version is available.' : share.alreadyInstalled ? 'This strategy is already installed.' : 'Ready when you are.'}</strong><span>Your current active strategy will not change.</span></div>
      {share.isOwner ? <Link className="button-link primary" href="/profile">You own this strategy</Link> : share.alreadyInstalled && !share.updateAvailable && share.installedStrategyId ? <Link className="button-link primary" href={`/strategies/${share.installedStrategyId}`}>Open my copy</Link> : <button type="button" className="primary" disabled={busy} onClick={() => void install()}>{busy ? 'Installing safely…' : actionLabel}</button>}
    </section>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </div>;
}
