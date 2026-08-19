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
  const [profileSearch, setProfileSearch] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isFounder, setIsFounder] = useState(false);

  const closeCreate = () => {
    setShowCreate(false);
    setError(null);
    setSuccess(null);
  };

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

  const filteredProfiles = useMemo(
    () =>
      profiles.filter((profile) => {
        const haystack = `${profile.name} ${profile.instruments.join(' ')} ${profile.marketTypes.join(' ')}`.toLowerCase();
        return !profileSearch || haystack.includes(profileSearch.toLowerCase());
      }),
    [profileSearch, profiles],
  );

  useEffect(() => {
    if (!showCreate || !filteredProfiles.length) return;
    if (!filteredProfiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(filteredProfiles[0].id);
    }
  }, [filteredProfiles, selectedProfileId, showCreate]);

  useEffect(() => {
    if (!showCreate) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCreate();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showCreate]);

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
          <button type="button" className="button secondary compact-button" onClick={() => setShowCreate(true)}>
            Add internal test strategy
          </button>
        ) : null}
      </header>

      {showCreate && isFounder ? (
        <div className="marketplace-create-modal-backdrop" onClick={closeCreate} role="presentation">
          <section className="marketplace-create-modal card" role="dialog" aria-modal="true" aria-labelledby="internal-test-title" onClick={(event) => event.stopPropagation()}>
            <div className="marketplace-create-header">
              <div>
                <span className="eyebrow">INTERNAL TEST</span>
                <h2 id="internal-test-title">Add internal test strategy</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close internal test creation" onClick={closeCreate}>
                ×
              </button>
            </div>

            <p className="marketplace-create-helper">Publish a vetted Trade Police strategy for founder-only internal review and evaluation.</p>

            <div className="marketplace-create-form">
              <label className="marketplace-field">
                <span>Search existing strategy profile</span>
                <input
                  value={profileSearch}
                  onChange={(event) => setProfileSearch(event.target.value)}
                  placeholder="Search by name, instrument, market"
                />
              </label>

              <div className="marketplace-profile-list" aria-live="polite">
                {filteredProfiles.length ? (
                  filteredProfiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className={profile.id === selectedProfileId ? 'marketplace-profile-option selected' : 'marketplace-profile-option'}
                      onClick={() => setSelectedProfileId(profile.id)}
                    >
                      <span>{profile.name}</span>
                      <small>{profile.marketTypes.join(', ') || 'Internal test'}</small>
                    </button>
                  ))
                ) : (
                  <div className="marketplace-empty-option">No strategy profiles match your search.</div>
                )}
              </div>

              {selectedProfile ? (
                <div className="marketplace-preview-card" aria-live="polite">
                  <div className="marketplace-preview-header">
                    <div>
                      <span className="eyebrow">PROFILE PREVIEW</span>
                      <h3>{selectedProfile.name}</h3>
                    </div>
                    <span className="status-badge">INTERNAL TEST</span>
                  </div>

                  <div className="marketplace-preview-grid">
                    <div>
                      <span>Instruments</span>
                      <strong>{selectedProfile.instruments.join(', ') || 'N/A'}</strong>
                    </div>
                    <div>
                      <span>Market / category</span>
                      <strong>{selectedProfile.marketTypes.join(', ') || 'Internal test'}</strong>
                    </div>
                    <div>
                      <span>Key timeframes</span>
                      <strong>
                        {[
                          selectedProfile.timeframeRoles.trend,
                          selectedProfile.timeframeRoles.confirmation,
                          selectedProfile.timeframeRoles.entry,
                        ].filter(Boolean).join(' · ') || 'N/A'}
                      </strong>
                    </div>
                  </div>

                  <div className="marketplace-protected-notice">
                    <strong>Protected configuration:</strong> Private rules, configuration, and strategy payload remain excluded from the browser listing DTO.
                  </div>
                </div>
              ) : null}

              <div className="marketplace-create-notices">
                <div className="marketplace-notice warning">Commerce is disabled for this internal test listing.</div>
                <div className="marketplace-notice subtle">Private rules and configuration remain protected.</div>
              </div>

              {error ? <p className="error">{error}</p> : null}
              {success ? <p className="success">{success}</p> : null}
            </div>

            <div className="marketplace-create-footer">
              <button type="button" className="button secondary" onClick={closeCreate}>
                Cancel
              </button>
              <button type="button" className="button primary" onClick={handleCreate} disabled={creating}>
                {creating ? 'Publishing…' : 'Publish internal test listing'}
              </button>
            </div>
          </section>
        </div>
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
