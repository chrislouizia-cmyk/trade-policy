import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AuthenticatedAppShell from '@/components/AuthenticatedAppShell';
import MarketplaceInstallButton from '@/components/MarketplaceInstallButton';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import { getPublicMarketplaceListing } from '@/lib/server/public-marketplace';

export default async function MarketplaceDetailPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/client/login?next=/marketplace/${listingId}`);
  const [displayName, listing] = await Promise.all([getUserDisplayName(supabase, user), getPublicMarketplaceListing(user.id, listingId)]);
  if (!listing) notFound();
  const metricReady = listing.metricStatus !== 'NOT_ENOUGH_VERIFIED_DATA';
  return <AuthenticatedAppShell eyebrow="TRADE POLICE / MARKETPLACE" displayName={displayName} description="Review evidence before adding a strategy." userId={user.id}>
    <Link className="button-link secondary compact-button" href="/marketplace">← Back to Marketplace</Link>
    <section className="card marketplace-public-detail"><div><p className="eyebrow">APPROVED STRATEGY</p><h1>{listing.name}</h1><p className="muted">By {listing.creator} · {listing.category} · {listing.instruments.join(' / ')}</p></div><div className={`marketplace-readiness-callout ${metricReady ? 'ready' : ''}`}><span className="status-badge">{metricReady ? 'Verified evidence' : 'Evidence building'}</span><div><strong>{listing.observationDays ?? 0} days under observation</strong><p>The observation clock starts on the strategy&apos;s first real recorded trade and continues across later edits. Performance remains tied to verified platform records.</p></div></div><dl className="marketplace-detail-metrics"><div><dt>Recorded trades</dt><dd>{listing.closedTrades ?? '—'}</dd></div><div><dt>Win rate</dt><dd>{listing.winRate == null ? '—' : `${listing.winRate}%`}</dd></div><div><dt>Total R</dt><dd>{listing.totalR == null ? '—' : `${listing.totalR}R`}</dd></div><div><dt>Expectancy</dt><dd>{listing.expectancyR == null ? '—' : `${listing.expectancyR}R`}</dd></div><div><dt>Max drawdown</dt><dd>{listing.maxDrawdownR == null ? '—' : `${listing.maxDrawdownR}R`}</dd></div><div><dt>Rule adherence</dt><dd>{listing.adherenceRate == null ? '—' : `${listing.adherenceRate}%`}</dd></div></dl><div className="marketplace-protected-notice">You receive a licensed in-app copy. The creator&apos;s private release snapshot is never sent to your browser, and the installed strategy remains inactive until you explicitly select it.</div><MarketplaceInstallButton listingId={listing.listingId} installed={listing.installed} /></section>
  </AuthenticatedAppShell>;
}
