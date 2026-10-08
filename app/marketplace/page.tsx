import Link from 'next/link';
import { redirect } from 'next/navigation';
import AuthenticatedAppShell from '@/components/AuthenticatedAppShell';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import { getPublicMarketplace } from '@/lib/server/public-marketplace';

export default async function MarketplacePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/client/login?next=/marketplace');
  const [displayName, listings] = await Promise.all([getUserDisplayName(supabase, user), getPublicMarketplace(user.id)]);
  return <AuthenticatedAppShell eyebrow="TRADE POLICE / MARKETPLACE" displayName={displayName} description="Discover reviewed strategies backed by recorded Trade Police evidence." userId={user.id}>
    <section className="card marketplace-public-hero"><p className="eyebrow">CURATED · VERIFIED · PROTECTED</p><h1>Strategy Marketplace</h1><p>Compare real platform evidence, understand each strategy, and add an inactive licensed copy in one step. Private rule data stays protected.</p></section>
    {listings.length ? <section className="marketplace-product-grid" aria-label="Public strategies">{listings.map((item) => <article className="marketplace-product-card" key={item.listingId}><header><span className="status-badge">Reviewed</span><small>{item.observationDays ?? 0} days observed</small></header><div className="marketplace-product-meta"><h2>{item.name}</h2><p>By {item.creator} · {item.category}</p><p>{item.instruments.join(' · ') || 'Instrument details available inside'}</p></div><div className="marketplace-product-stats"><div><span>RECORDED TRADES</span><strong>{item.closedTrades ?? 'Building evidence'}</strong></div><div><span>WIN RATE</span><strong>{item.winRate == null ? 'Not enough data' : `${item.winRate}%`}</strong></div><div><span>TOTAL R</span><strong>{item.totalR == null ? '—' : `${item.totalR}R`}</strong></div><div><span>ADHERENCE</span><strong>{item.adherenceRate == null ? '—' : `${item.adherenceRate}%`}</strong></div></div><footer className="marketplace-footer"><strong>Free beta install</strong><small>No payment. Installed inactive.</small><Link className="button primary" href={`/marketplace/${item.listingId}`}>View strategy</Link></footer></article>)}</section> : <section className="card empty-state"><h2>The public shelf is being curated.</h2><p>Approved strategies will appear here after owner consent and Compliance review. Nothing private is published automatically.</p></section>}
  </AuthenticatedAppShell>;
}
