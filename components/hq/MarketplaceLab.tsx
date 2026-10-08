'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MarketplaceCandidatePreview, MarketplaceReleasePreview } from '@/lib/marketplace/contracts';

const MarketplaceReleaseDetail = dynamic(() => import('@/components/hq/MarketplaceReleaseDetail'), {
  loading: () => <section className="card empty-state"><p>Loading full strategy evidence…</p></section>,
});

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
  currentRevisionId: string;
  hasInternalTestRelease: boolean;
  existingInternalTestListing: {
    listingId: string;
    releaseId: string;
    strategyName: string;
    reviewStatus: string;
  } | null;
};

const score = (value: number | null) => value ?? -Infinity;
const CATALOG_PAGE_SIZE = 10;
const candidateReadinessScore = (candidate: MarketplaceCandidatePreview) => {
  const statusWeight: Record<MarketplaceCandidatePreview['status'], number> = {
    APPROVED: 8, UNDER_REVIEW: 7, OWNER_CONSENT_PENDING: 6, QUALIFIED: 5,
    OBSERVING: 4, INSUFFICIENT_DATA: 3, DECLINED: 2, ARCHIVED: 1,
  };
  const dayProgress = Math.min(1, candidate.observationDays / Math.max(1, candidate.policy.minimumObservationDays));
  const tradeProgress = Math.min(1, candidate.closedTrades / Math.max(1, candidate.policy.minimumClosedTrades));
  const adherenceProgress = candidate.adherencePercent === null ? 0 : Math.min(1, candidate.adherencePercent / Math.max(1, candidate.policy.minimumAdherencePercent));
  return statusWeight[candidate.status] * 100 + dayProgress * 35 + tradeProgress * 45 + adherenceProgress * 20;
};

export default function MarketplaceLab() {
  const [items, setItems] = useState<MarketplaceReleasePreview[]>([]);
  const [profiles, setProfiles] = useState<StrategyOption[]>([]);
  const [candidates, setCandidates] = useState<MarketplaceCandidatePreview[]>([]);
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
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [visibleCandidateCount, setVisibleCandidateCount] = useState(CATALOG_PAGE_SIZE);
  const [visibleListingCount, setVisibleListingCount] = useState(CATALOG_PAGE_SIZE);
  const [candidateEvidence,setCandidateEvidence]=useState<Record<string,any>>({});
  const [candidateEvidenceState,setCandidateEvidenceState]=useState<Record<string,string>>({});
  const autoSyncStarted=useRef(false);

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
        setCandidates(body.candidates ?? []);
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
    if (!showCreate && !selectedCandidateId && !selectedListingId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showCreate) closeCreate();
      else if (selectedCandidateId) setSelectedCandidateId(null);
      else setSelectedListingId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedCandidateId, selectedListingId, showCreate]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.candidateId === selectedCandidateId) ?? null,
    [candidates, selectedCandidateId],
  );

  const rankedCandidates = useMemo(
    () => [...candidates].sort((a, b) => candidateReadinessScore(b) - candidateReadinessScore(a)),
    [candidates],
  );
  const visibleCandidates = rankedCandidates.slice(0, visibleCandidateCount);

  const openInternalTestForCandidate = (strategyId: string) => {
    setSelectedCandidateId(null);
    setSelectedProfileId(strategyId);
    setProfileSearch('');
    setError(null);
    setShowCreate(true);
  };

  const openCandidateDetails=async(candidateId:string)=>{
    setSelectedCandidateId(candidateId);
    if(candidateEvidence[candidateId])return;
    setCandidateEvidenceState(current=>({...current,[candidateId]:'Loading recorded evidence…'}));
    try{
      const response=await fetch(`/api/hq/marketplace/candidates/${candidateId}`,{cache:'no-store'});
      const body=await response.json();if(!response.ok)throw new Error(body.error||'Recorded evidence unavailable.');
      setCandidateEvidence(current=>({...current,[candidateId]:body}));
      setCandidates(current=>current.map(candidate=>candidate.candidateId===candidateId?{...candidate,...body.candidate}:candidate));
      setCandidateEvidenceState(current=>({...current,[candidateId]:''}));
    }catch(caught){
      setCandidateEvidenceState(current=>({...current,[candidateId]:caught instanceof Error?caught.message:'Recorded evidence unavailable.'}));
    }
  };

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
  const visibleListings = filtered.slice(0, visibleListingCount);

  useEffect(() => setVisibleListingCount(CATALOG_PAGE_SIZE), [health, query, release, sort]);

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
      if (!response.ok) {
        if (body.code === 'DUPLICATE_MARKETPLACE_RELEASE') {
          setProfiles((current) => current.map((profile) => profile.id === selectedProfileId
            ? { ...profile, hasInternalTestRelease: true, existingInternalTestListing: body.existingListing ?? profile.existingInternalTestListing }
            : profile));
          const existingName = body.existingListing?.strategyName ? ` as “${body.existingListing.strategyName}”` : '';
          throw new Error(`This exact strategy revision is already listed${existingName}. Open the existing listing below, or create a new strategy revision first.`);
        }
        throw new Error(body.error || 'Internal strategy creation failed.');
      }
      setSuccess(`Published internal test release for ${selectedProfile?.name ?? 'strategy profile'}.`);
      setShowCreate(false);
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Internal strategy creation failed.');
    } finally {
      setCreating(false);
    }
  };

  const handleSync=async()=>{
    setSyncing(true);setError(null);setSyncSummary(null);
    let offset=0,totalSynchronized=0,totalFailures=0;
    try{
      while(true){
        const response=await fetch('/api/hq/marketplace/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({offset}),cache:'no-store'});
        const body=await response.json();if(!response.ok)throw new Error(body.error||'Strategy synchronization failed.');
        totalSynchronized+=Number(body.synchronized??0);totalFailures+=Array.isArray(body.failures)?body.failures.length:0;
        if(!body.hasMore)break;offset=Number(body.nextOffset??offset+25);
      }
      const catalog=await fetch('/api/hq/marketplace',{cache:'no-store'});const body=await catalog.json();
      if(!catalog.ok)throw new Error(body.error||'Marketplace catalog refresh failed.');
      setItems(body.items??[]);setCandidates(body.candidates??[]);
      setSyncSummary(`${totalSynchronized} strategies evaluated${totalFailures?` · ${totalFailures} require attention`:''}.`);
    }catch(caught){setError(caught instanceof Error?caught.message:'Strategy synchronization failed.');}
    finally{setSyncing(false);}
  };

  useEffect(()=>{
    if(!isFounder||autoSyncStarted.current)return;
    autoSyncStarted.current=true;
    void handleSync();
    // This runs once after founder authorization is resolved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isFounder]);

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
        {isFounder ? <div className="marketplace-hero-actions">
          <button type="button" className="button secondary compact-button" onClick={handleSync} disabled={syncing}>{syncing?'Evaluating strategies…':'Evaluate all strategies'}</button>
          <button type="button" className="button secondary compact-button" onClick={() => setShowCreate(true)}>Add internal test strategy</button>
        </div> : null}
      </header>

      {syncSummary?<p className="success" role="status">{syncSummary}</p>:null}
      {error&&!showCreate?<p className="error" role="alert">{error}</p>:null}

      <section className="card marketplace-observation-board">
        <div className="section-title"><div><span className="eyebrow">PRIVATE OBSERVATION</span><h2>Strategy qualification pipeline</h2></div><strong>{candidates.length} current strategies</strong></div>
        <p className="muted">Every strategy can accumulate private evidence. Qualification never publishes it: owner consent and Compliance approval remain mandatory.</p>
        {candidates.length?<><div className="marketplace-candidate-grid">{visibleCandidates.map(candidate=>{
          const tradeProgress=Math.min(100,Math.round(candidate.closedTrades/candidate.policy.minimumClosedTrades*100));
          const dayProgress=Math.min(100,Math.round(candidate.observationDays/candidate.policy.minimumObservationDays*100));
          return <article key={candidate.candidateId} className="marketplace-candidate-card">
            <div><span className={`status-badge ${candidate.status.toLowerCase()}`}>{candidate.status.replaceAll('_',' ')}</span><h3>{candidate.strategyName}</h3><p>{candidate.ownerName??'Private owner'} · {candidate.instruments.join(', ')||'No instrument'}</p></div>
            <dl><div><dt>Observation</dt><dd>{candidate.observationDays}/{candidate.policy.minimumObservationDays} days</dd></div><div><dt>Recorded trades</dt><dd>{candidate.closedTrades}/{candidate.policy.minimumClosedTrades}</dd></div><div><dt>Rule adherence</dt><dd>{candidate.adherencePercent===null?'No evidence':`${candidate.adherencePercent}%`}</dd></div><div><dt>Consent</dt><dd>{candidate.consentStatus.replaceAll('_',' ')}</dd></div></dl>
            <div className="marketplace-progress" aria-label={`Observation ${dayProgress} percent`}><i style={{width:`${dayProgress}%`}}/></div>
            <div className="marketplace-progress trades" aria-label={`Recorded trades ${tradeProgress} percent`}><i style={{width:`${tradeProgress}%`}}/></div>
            <button className="button secondary compact-button" type="button" aria-haspopup="dialog" onClick={()=>void openCandidateDetails(candidate.candidateId)}>View qualification details</button>
          </article>;
        })}{rankedCandidates.length>visibleCandidateCount?<button className="marketplace-more-card" type="button" onClick={()=>setVisibleCandidateCount(count=>count+CATALOG_PAGE_SIZE)}><strong>View more strategies</strong><span>{rankedCandidates.length-visibleCandidateCount} remaining</span></button>:null}</div>{visibleCandidateCount>CATALOG_PAGE_SIZE?<button className="button secondary compact-button" type="button" onClick={()=>setVisibleCandidateCount(CATALOG_PAGE_SIZE)}>Show top 10</button>:null}</>:<div className="empty-state"><p>No strategy revisions have been evaluated yet.</p>{isFounder?<button className="button secondary" type="button" onClick={handleSync} disabled={syncing}>Start private evaluation</button>:null}</div>}
      </section>

      {selectedCandidate ? createPortal((
        <div className="marketplace-create-modal-backdrop" onClick={()=>setSelectedCandidateId(null)} role="presentation">
          <section className="marketplace-detail-modal card" role="dialog" aria-modal="true" aria-labelledby="qualification-detail-title" onClick={(event)=>event.stopPropagation()}>
            <div className="marketplace-create-header">
              <div><span className="eyebrow">QUALIFICATION · EXACT REVISION</span><h2 id="qualification-detail-title">{selectedCandidate.strategyName}</h2></div>
              <button type="button" className="icon-button" aria-label="Close qualification details" autoFocus onClick={()=>setSelectedCandidateId(null)}>×</button>
            </div>
            <div className="marketplace-detail-scroll">
              <div className={`marketplace-readiness-callout ${selectedCandidate.status==='APPROVED'||selectedCandidate.status==='QUALIFIED'?'ready':'not-ready'}`}>
                <span className={`status-badge ${selectedCandidate.status.toLowerCase()}`}>{selectedCandidate.status.replaceAll('_',' ')}</span>
                <div><strong>{selectedCandidate.status==='APPROVED'||selectedCandidate.status==='QUALIFIED'?'Qualification requirements are satisfied.':'Not ready for public Marketplace yet.'}</strong><p>Internal testing does not bypass owner consent, Compliance review, or the recorded-evidence policy.</p></div>
              </div>
              <div className="marketplace-qualification-grid">
                <QualificationMetric label="Observation" value={`${selectedCandidate.observationDays}/${selectedCandidate.policy.minimumObservationDays} days`} pass={selectedCandidate.observationDays>=selectedCandidate.policy.minimumObservationDays}/>
                <QualificationMetric label="Recorded trades" value={`${selectedCandidate.closedTrades}/${selectedCandidate.policy.minimumClosedTrades}`} pass={selectedCandidate.closedTrades>=selectedCandidate.policy.minimumClosedTrades}/>
                <QualificationMetric label="Rule adherence" value={selectedCandidate.adherencePercent===null?'No evidence':`${selectedCandidate.adherencePercent}% / ${selectedCandidate.policy.minimumAdherencePercent}%`} pass={selectedCandidate.adherencePercent!==null&&selectedCandidate.adherencePercent>=selectedCandidate.policy.minimumAdherencePercent}/>
                <QualificationMetric label="Critical violations" value={`${selectedCandidate.criticalViolations} / ${selectedCandidate.policy.maximumCriticalViolations} allowed`} pass={selectedCandidate.criticalViolations<=selectedCandidate.policy.maximumCriticalViolations}/>
                <QualificationMetric label="Maximum drawdown" value={selectedCandidate.maximumDrawdownR===null?'No evidence':`${selectedCandidate.maximumDrawdownR}R / ${selectedCandidate.policy.maximumDrawdownR}R`} pass={selectedCandidate.maximumDrawdownR!==null&&selectedCandidate.maximumDrawdownR<=selectedCandidate.policy.maximumDrawdownR}/>
                <QualificationMetric label="Owner consent" value={selectedCandidate.consentStatus.replaceAll('_',' ')} pass={selectedCandidate.consentStatus==='GRANTED'}/>
              </div>
              {candidateEvidenceState[selectedCandidate.candidateId]?<p className="muted" role="status">{candidateEvidenceState[selectedCandidate.candidateId]}</p>:null}
              {candidateEvidence[selectedCandidate.candidateId]?.evidence?<CandidateEvidence evidence={candidateEvidence[selectedCandidate.candidateId].evidence}/>:null}
            </div>
            {isFounder?<CandidateMarketplaceAction candidate={selectedCandidate} profiles={profiles} onCreate={openInternalTestForCandidate} onOpenListing={(listingId)=>{setSelectedCandidateId(null);setSelectedListingId(listingId);}}/>:null}
          </section>
        </div>
      ),document.body):null}

      {showCreate && isFounder ? createPortal((
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
                      <small>{profile.hasInternalTestRelease ? `Already listed${profile.existingInternalTestListing?.strategyName?` as “${profile.existingInternalTestListing.strategyName}”`:''}` : profile.marketTypes.join(', ') || 'Available for internal test'}</small>
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
                  {selectedProfile.existingInternalTestListing ? <div className="marketplace-existing-listing">
                    <p>This exact revision already exists as <strong>“{selectedProfile.existingInternalTestListing.strategyName}”</strong> · {selectedProfile.existingInternalTestListing.reviewStatus.replaceAll('_',' ')}.</p>
                    <button className="button secondary compact-button" type="button" onClick={()=>{const listingId=selectedProfile.existingInternalTestListing?.listingId;if(!listingId)return;closeCreate();setSelectedListingId(listingId);}}>Open existing listing</button>
                  </div> : null}
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
              <button type="button" className="button primary" onClick={handleCreate} disabled={creating || !selectedProfile || selectedProfile.hasInternalTestRelease}>
                {creating ? 'Publishing…' : 'Publish internal test listing'}
              </button>
            </div>
          </section>
        </div>
      ), document.body) : null}

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
          {visibleListings.map((item) => (
            <article className="card marketplace-product-card" key={item.releaseId}>
              <div className="marketplace-product-meta">
                <span className="eyebrow">{item.reviewStatus}</span>
                <h3>{item.listing.strategyName}</h3>
                <p>{item.listing.creatorName ?? 'Trade Police'} · {item.listing.category ?? 'INTERNAL_TEST'}</p>
              </div>
              <div className="marketplace-product-stats">
                <div><span>PERFORMANCE</span><strong>{item.scores.performance ?? 'Not enough recorded data'}</strong></div>
                <div><span>READINESS</span><strong>{item.scores.marketplaceReadiness ?? 'Not enough recorded data'}</strong></div>
                <div><span>RECORDED TRADES</span><strong>{item.usage.trades}</strong></div>
                <div><span>SAVED DECISIONS</span><strong>{item.usage.decisions}</strong></div>
              </div>
              <div className="marketplace-footer">
                <small>Release v{item.releaseVersion} · {item.listing.instruments.join(', ') || 'No instrument recorded'}</small>
                <button className="button secondary" type="button" aria-haspopup="dialog" onClick={()=>setSelectedListingId(item.listing.listingId)}>View full strategy</button>
              </div>
            </article>
          ))}
          {filtered.length>visibleListingCount?<button className="marketplace-more-card" type="button" onClick={()=>setVisibleListingCount(count=>count+CATALOG_PAGE_SIZE)}><strong>View more listings</strong><span>{filtered.length-visibleListingCount} remaining</span></button>:null}
        </section>
      )}

      {selectedListingId ? createPortal((
        <div className="marketplace-create-modal-backdrop" onClick={()=>setSelectedListingId(null)} role="presentation">
          <section className="marketplace-release-modal card" role="dialog" aria-modal="true" aria-labelledby="marketplace-release-title" onClick={(event)=>event.stopPropagation()}>
            <div className="marketplace-create-header"><div><span className="eyebrow">STRATEGY RELEASE</span><h2 id="marketplace-release-title">Full strategy evidence</h2></div><button type="button" className="icon-button" aria-label="Close strategy details" autoFocus onClick={()=>setSelectedListingId(null)}>×</button></div>
            <div className="marketplace-detail-scroll"><MarketplaceReleaseDetail listingId={selectedListingId} embedded/></div>
          </section>
        </div>
      ),document.body):null}
    </div>
  );
}

function QualificationMetric({label,value,pass}:{label:string;value:string;pass:boolean}){return <div className={pass?'pass':'pending'}><span>{label}</span><strong>{value}</strong><small>{pass?'Requirement met':'Still required'}</small></div>}

function CandidateMarketplaceAction({candidate,profiles,onCreate,onOpenListing}:{candidate:MarketplaceCandidatePreview;profiles:StrategyOption[];onCreate:(strategyId:string)=>void;onOpenListing:(listingId:string)=>void}){
  const profile=profiles.find(item=>item.id===candidate.strategyId&&item.currentRevisionId===candidate.strategyRevisionId);
  const existing=profile?.existingInternalTestListing;
  return <div className="marketplace-modal-actions">{profile?.hasInternalTestRelease?<><p>This exact revision is already listed{existing?.strategyName?` as “${existing.strategyName}”`:''}. No duplicate was created.</p>{existing?<button className="button secondary" type="button" onClick={()=>onOpenListing(existing.listingId)}>Open existing listing</button>:null}</>:<button className="button primary" type="button" onClick={()=>onCreate(candidate.strategyId)}>Create internal test listing</button>}</div>;
}

function CandidateEvidence({evidence}:{evidence:any}){
  const live=evidence.live,points=live.equityCurve??[];
  const values=points.map((point:any)=>Number(point.cumulativeR)),min=Math.min(...values,0),max=Math.max(...values,0),range=Math.max(max-min,1);
  const geometry=points.length>1?points.map((point:any,index:number)=>`${index/(points.length-1)*100},${92-(Number(point.cumulativeR)-min)/range*84}`).join(' '):null;
  return <section className="marketplace-candidate-proof" aria-label="Exact revision platform-recorded evidence">
    <div><span className="eyebrow">EXACT REVISION · PLATFORM-RECORDED RESULTS</span><h4>Evidence report</h4><p>Closed trades recorded in Trade Police and historical simulations are kept separate. Broker verification is not available yet.</p></div>
    <dl><div><dt>Total R</dt><dd>{live.totalR==null?'No evidence':`${live.totalR}R`}</dd></div><div><dt>Win rate</dt><dd>{live.winRate==null?'No evidence':`${live.winRate}%`}</dd></div><div><dt>Maximum drawdown</dt><dd>{live.maxDrawdownR==null?'No evidence':`${live.maxDrawdownR}R`}</dd></div><div><dt>Rule adherence</dt><dd>{live.adherencePercent==null?'No evidence':`${live.adherencePercent}%`}</dd></div></dl>
    {geometry?<svg className="marketplace-equity-chart compact" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Cumulative recorded R curve"><line x1="0" y1="92" x2="100" y2="92"/><polyline points={geometry}/></svg>:<div className="marketplace-equity-empty compact">The recorded R curve appears after the first closed trade.</div>}
    <div><h4>Recent recorded trades</h4>{live.recentTrades.length?<div className="marketplace-trade-list">{live.recentTrades.slice(0,5).map((trade:any)=><div className="marketplace-trade-row" key={trade.id}><span><strong>{trade.instrument}</strong><small>{new Date(trade.closedAt).toLocaleString()}</small></span><strong className={trade.resultR>=0?'positive':'negative'}>{trade.resultR>=0?'+':''}{trade.resultR}R</strong><span>{trade.followedVerdict?'Rules followed':'Override'}</span></div>)}</div>:<p className="muted">No closed recorded trades exist for this revision yet.</p>}</div>
    <div><span className="eyebrow">HISTORICAL SIMULATION · SEPARATE EVIDENCE</span>{evidence.backtests.length?<div className="marketplace-backtest-list">{evidence.backtests.map((run:any)=><div className="marketplace-backtest-row" key={run.id}><span><strong>{run.instrument} · {run.execution_timeframe}</strong><small>{run.period_start} → {run.period_end}</small></span><span>{run.result?`${run.result.total_trades??0} trades · ${run.result.net_return_percent??'—'}% net`:'Completed'}</span></div>)}</div>:<p className="muted">No completed backtest exists for this exact revision.</p>}</div>
  </section>;
}
