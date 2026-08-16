import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getBillingState } from '@/lib/billing/entitlements';
import { billingEnabled } from '@/lib/billing/config';
import { PUBLIC_PLAN_CODES, PUBLIC_PLAN_PRICING } from '@/lib/billing/plans';
import BillingActions from '@/components/BillingActions';

const visiblePlanText = {
  FREE: '$0',
  PRO: '$29 / month',
  ELITE: '$59 / month',
  TEAM: '$149 / month',
  PRO_ANNUAL: '$279 / year',
  ELITE_ANNUAL: '$569 / year',
  TEAM_ANNUAL: '$1,429 / year',
} as const;

export default async function Pricing() {
  const s = await createClient();
  const { data: { user } } = await s.auth.getUser();
  const state = user ? await getBillingState(user.id) : null;
  const enabled = billingEnabled();

  return <main className="marketing-page">
    <nav className="marketing-nav">
      <Link className="marketing-brand" href="/"><span>TP</span> Trade Police</Link>
      <Link className="button-link secondary" href={user ? '/account' : '/client/login'}>{user ? 'Account' : 'Sign in'}</Link>
    </nav>
    <section className="marketing-hero compact">
      <p className="eyebrow">PRICING</p>
      <h1>Start free. Upgrade when your process needs more capacity.</h1>
      <p>All plans use the same deterministic decision logic. Higher tiers add analysis and strategy capacity; they do not change the authorization rules or the meaning of a READY decision.</p>
    </section>
    <section className="marketing-section pricing-grid">{PUBLIC_PLAN_CODES.map((code) => {
      const current = state?.plan === code;
      const pricing = PUBLIC_PLAN_PRICING[code];
      const cta = code === 'FREE' && !user ? <Link className="button-link primary plan-cta" href="/client/login?mode=signup&next=/onboarding">Start free</Link> : code === 'FREE' && user ? <Link className="button-link secondary plan-cta" href="/account">Account</Link> : code !== 'FREE' && !user ? <Link className="button-link primary plan-cta" href="/client/login?next=/pricing">Sign in to upgrade</Link> : code !== 'FREE' && user && state?.plan === code ? <Link className="button-link secondary plan-cta" href="/account">View subscription</Link> : code !== 'FREE' && user && state?.plan !== code ? (enabled ? <BillingActions mode="checkout" plan={code} /> : code === 'ELITE' || code === 'TEAM' ? <Link className="button-link secondary plan-cta" href="/about">Contact sales</Link> : <p className="muted">Billing is disabled in this environment.</p>) : null;
      const features = code === 'FREE' ? ['15 analyses per anchored monthly cycle', '1 active strategy'] : code === 'PRO' ? ['250 analyses per anchored monthly cycle', '5 active strategies', 'Deterministic trade decision review', 'Expanded strategy history'] : code === 'ELITE' ? ['1,000 analyses per anchored monthly cycle', '10 active strategies', 'Higher usage for active traders', 'Expanded review and analytics'] : ['Unlimited analyses', 'Unlimited active strategies', 'Shared team-oriented workflows', 'Desk or organization coordination'];
      const displayPrice = code === 'FREE' ? visiblePlanText.FREE : code === 'PRO' ? visiblePlanText.PRO : code === 'ELITE' ? visiblePlanText.ELITE : visiblePlanText.TEAM;
      const displayAnnual = code === 'FREE' ? visiblePlanText.FREE : code === 'PRO' ? visiblePlanText.PRO_ANNUAL : code === 'ELITE' ? visiblePlanText.ELITE_ANNUAL : visiblePlanText.TEAM_ANNUAL;
      return <article className={`marketing-card plan-card ${current ? 'current-plan' : ''}`} key={code}>
        <p className="eyebrow">{code}{current ? ' · CURRENT PLAN' : ''}</p>
        <h2>{displayPrice}</h2>
        {code !== 'FREE' && <p className="muted">{displayAnnual}</p>}
        {code !== 'FREE' && <p className="muted">Save ~20% with annual billing</p>}
        <p className="plan-promise">{pricing.summary}</p>
        <div className="plan-features">
          <ul>{features.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        {cta && <div className="button-row plan-cta-wrap">{cta}</div>}
      </article>;
    })}</section>
    <section className="marketing-section">
      <h2>What never changes with your plan</h2>
      <p>Rules remain visible, missing evidence never silently passes, AI does not override deterministic authorization, and no plan promises profit or a guaranteed outcome.</p>
    </section>
    <footer className="marketing-footer"><Link href="/">Home</Link><Link href="/about">About</Link><Link href="/faq">FAQ</Link><Link href="/legal">Legal & risk</Link></footer>
  </main>;
}
