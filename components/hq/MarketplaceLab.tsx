'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { MarketplaceReleasePreview } from '@/lib/marketplace/contracts';

type Sort = 'RANK' | 'PERFORMANCE' | 'READINESS' | 'TRENDING' | 'NEWEST';
type StrategyOption = {
  id: string;
  name: string;
  instruments: string[];
  marketTypes: string[];
  timeframeRoles: {
    macro: string | null;
    trend: string | null;
    confirmation: string | null;
    entry: string | null;
    trigger: string | null;
  };
  createdAt: string | null;
};

const score = (value: number | null) => value ?? -Infinity;

export default function MarketplaceLab() {
  const [items, setItems] = useState<MarketplaceReleasePreview[]>([]);
  const [profiles, setProfiles] = useState<StrategyOption[]>([]);
  const [state, setState] = useState('Loading Marketplace Lab…');
  const [query, setQuery] = useState('');
  const [health, setHealth] = useState('');
  const [release, setRelease] = useState('');
  const [sort, setSort] = useState<Sort>('RANK');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isFounder, setIsFounder] = useState(false);

  useEffect(() => {
    void fetch('/api/hq/marketplace', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Marketplace Lab unavailable.');
        setItems(body.items ?? []);
        setState('');
      })
      .catch((caught: unknown) => setState(caught instanceof Error ? caught.message : 'Marketplace Lab unavailable.'));

    void fetch('/api/hq/marketplace?mode=profiles', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) return;
        setIsFounder(Boolean(body.isFounder));
        setProfiles(body.profiles ?? []);
        if (Array.isArray(body.profiles) && body.profiles.length) {
          setSelectedProfileId(body.profiles[0].id);
        }
      })
      .catch(() => {
        setIsFounder(false);
        setProfiles([]);
      });
  }, []);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const filtered = useMemo(
    () =>
      items
        .filter((item) => {
          const haystack = [item.listing.strategyName, item.listing.creatorName ?? '', item.listing.category ?? '', ...item.listing.instruments].join(' ').toLowerCase();
          return (!query || haystack.includes(query.toLowerCase())) && (!health || item.listing.compatibility === health) && (!release || item.reviewStatus === release);
        })
        .sort((a, b) => {
          if (sort === 'PERFORMANCE') return score(b.scores.performance) - score(a.scores.performance);
          if (sort === 'READINESS') return score(b.scores.marketplaceReadiness) - score(a.scores.marketplaceReadiness);
          if (sort === 'TRENDING') return b.usage.decisions - a.usage.decisions;
          if (sort === 'NEWEST') return b.releaseVersion - a.releaseVersion;
          return score(b.scores.performance) - score(a.scores.performance);
        }),
    [items, health, query, release, sort],
  );

  const handleCreate = async () => {
    if (!selectedProfileId) {
      setError('Select a strategy profile to create an internal test listing.');
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/hq/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyProfileId: selectedProfileId }),
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Internal strategy creation failed.');
      setSuccess(`Published internal test release for ${selectedProfile?.name ?? 'strategy profile'}.`);
      setShowCreate(false);
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Internal strategy creation failed.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="stack marketplace-lab">
      <header className="marketplace-hero">
        <span className="eyebrow">MARKETPLACE LAB · INTERNAL ONLY</span>
        <h1>Curated strategy marketplace</h1>
        <p>Founder, Sales, and Compliance preview. No checkout, payout, customer visibility, or live commerce.</p>
        <dl>
          <div><dt>Listings</dt><dd>{items.length}</dd></div>
          <div><dt>Mode</dt><dd>INTERNAL TEST</dd></div>
          <div><dt>Commerce</dt><dd>Disabled</dd></div>
        </dl>
        {isFounder ? (
          <button type="button" className="primary" onClick={() => setShowCreate((value) => !value)}>
            Add internal test strategy
          </button>
        ) : null}
      </header>

      {showCreate && isFounder ? (
        <section className="card marketplace-controls">
          <h2>Internal test strategy</h2>
          <label>
            Existing Trade Police-owned strategy profile
            <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </label>

          {selectedProfile ? (
            <div className="card" aria-live="polite">
              <h3>Sanitized preview</h3>
              <p><strong>{selectedProfile.name}</strong></p>
              <p>Market: {selectedProfile.marketTypes.join(', ') || 'Internal test'}</p>
              <p>Instruments: {selectedProfile.instruments.join(', ') || 'N/A'}</p>
              <p>Core timeframes: {selectedProfile.timeframeRoles.trend ?? 'N/A'} / {selectedProfile.timeframeRoles.confirmation ?? 'N/A'} / {selectedProfile.timeframeRoles.entry ?? 'N/A'}</p>
              <p>Private rules, thresholds, weights, and strategy payload remain excluded from the listing DTO.</p>
              <button type="button" className="primary" onClick={handleCreate} disabled={creating}>
                {creating ? 'Publishing…' : 'Publish internal test listing'}
              </button>
            </div>
          ) : null}

          {error ? <p className="error">{error}</p> : null}
          {success ? <p className="success">{success}</p> : null}
        </section>
      ) : null}

      {state ? <p className="muted">{state}</p> : null}

      <section className="card marketplace-controls">
        <label>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Creator, strategy, instrument, category" />
        </label>
        <label>
          Health
          <select value={health} onChange={(event) => setHealth(event.target.value)}>
            <option value="">All</option>
            <option value="COMPATIBLE">Compatible</option>
            <option value="UNAVAILABLE">Unavailable</option>
            <option value="NEEDS_REVIEW">Needs review</option>
          </select>
        </label>
        <label>
          Review status
          <select value={release} onChange={(event) => setRelease(event.target.value)}>
            <option value="">All</option>
            <option value="APPROVED">Approved</option>
            <option value="DRAFT">Draft</option>
            <option value="IN_REVIEW">In review</option>
            <option value="REJECTED">Rejected</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            <option value="RANK">Rank</option>
            <option value="PERFORMANCE">Performance</option>
            <option value="READINESS">Readiness</option>
            <option value="TRENDING">Trending</option>
            <option value="NEWEST">Newest</option>
          </select>
        </label>
      </section>

      {filtered.length === 0 ? (
        <section className="card empty-state">
          <p>No internal listings yet.</p>
          <Link href="/hq/marketplace">Refresh catalog</Link>
        </section>
      ) : (
        <section className="marketplace-product-grid">
          {filtered.map((item) => (
            <article className="card marketplace-product-card" key={item.releaseId}>
              <div className="marketplace-product-meta">
                <span className="eyebrow">{item.reviewStatus}</span>
                <h3>{item.listing.strategyName}</h3>
                <p>{item.listing.creatorName ?? 'Trade Police'} · {item.listing.category ?? 'INTERNAL_TEST'}</p>
              </div>
              <div className="marketplace-product-stats">
                <div><span>PERFORMANCE</span><strong>{item.scores.performance ?? 'Not enough verified data'}</strong></div>
                <div><span>READINESS</span><strong>{item.scores.marketplaceReadiness ?? 'Not enough verified data'}</strong></div>
                <div><span>TRENDING</span><strong>{item.usage.decisions}</strong></div>
                <div><span>NEWEST</span><strong>v{item.releaseVersion}</strong></div>
              </div>
              <div className="marketplace-footer">
                <Link href={`/hq/marketplace/${item.releaseId}`}>View strategy / Preview</Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
