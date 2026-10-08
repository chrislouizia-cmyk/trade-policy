'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import BillingActions from '@/components/BillingActions';
import { PUBLIC_PLAN_CODES, PUBLIC_PLAN_PRICING } from '@/lib/billing/plans';

export default function PricingPage({
  user,
  state,
  enabled,
  pricingCopy,
}: {
  user: { id: string } | null;
  state: { plan?: string } | null;
  enabled: boolean;
  pricingCopy?: {
    lead?: string;
    pro?: string;
    proLimit?: string;
    proStrategies?: string;
    billingActions?: string;
  };
}) {
  void pricingCopy;
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('monthly');

  return (
    <main className="marketing-page">
      <nav className="marketing-nav">
        <Link className="marketing-brand" href="/" aria-label="Trade Police"><Image src="/brand/trade-police-logo.png" alt="Trade Police" width={232} height={48} className="brand-logo-wordmark" /></Link>
        <Link className="button-link secondary" href={user ? '/account' : '/client/login'}>{user ? 'Account' : 'Sign in'}</Link>
      </nav>

      <section className="pricing-shell">
        <p className="eyebrow">PRICING</p>
        <h1>Simple pricing. Powerful decisions.</h1>
        <p>
          All plans use the same deterministic decision logic. Higher tiers add analysis and strategy
          capacity while preserving the same decision framework and risk posture.
        </p>

        <div className="pricing-segmented" aria-label="Billing interval">
          <button
            type="button"
            className={billingInterval === 'monthly' ? 'selected' : ''}
            aria-pressed={billingInterval === 'monthly'}
            onClick={() => setBillingInterval('monthly')}
          >
            Monthly
          </button>
          <button
            type="button"
            className={billingInterval === 'annual' ? 'selected' : ''}
            aria-pressed={billingInterval === 'annual'}
            onClick={() => setBillingInterval('annual')}
          >
            Annual
          </button>
        </div>
      </section>

      <section className="marketing-section pricing-grid">
        {PUBLIC_PLAN_CODES.map((code) => {
          const current = state?.plan === code;
          const pricing = PUBLIC_PLAN_PRICING[code];
          const displayPrice = code === 'FREE'
            ? '$0'
            : billingInterval === 'monthly'
              ? pricing.monthly
              : pricing.annual;
          const billingLabel = code === 'FREE'
            ? 'Always free'
            : billingInterval === 'monthly'
              ? 'Billed monthly'
              : 'Billed annually';

          const cta = code === 'FREE' && !user
            ? <Link className="button-link primary plan-cta" href="/client/login?mode=signup&next=/onboarding">Start free</Link>
            : code === 'FREE' && user
              ? <Link className="button-link secondary plan-cta" href="/account">Account</Link>
              : code !== 'FREE' && !user
                ? <Link className="button-link primary plan-cta" href="/client/login?next=/pricing">Sign in to upgrade</Link>
                : code !== 'FREE' && user && state?.plan === code
                  ? <Link className="button-link secondary plan-cta" href="/account">View subscription</Link>
                  : code !== 'FREE' && user && state?.plan !== code
                    ? (enabled
                      ? (
                        <BillingActions
                          mode="checkout"
                          plan={code}
                          interval={billingInterval}
                          onIntervalChange={setBillingInterval}
                        />
                      )
                      : code === 'ELITE' || code === 'TEAM'
                        ? <Link className="button-link secondary plan-cta" href="/about">Contact sales</Link>
                        : <p className="muted">Billing is disabled in this environment.</p>)
                    : null;

          const features = code === 'FREE'
            ? ['15 analyses per anchored monthly cycle', '1 active strategy']
            : code === 'PRO'
              ? ['250 analyses per anchored monthly cycle', '5 active strategies', 'Deterministic trade decision review', 'Expanded strategy history']
              : code === 'ELITE'
                ? ['1,000 analyses per anchored monthly cycle', '10 active strategies', 'Higher usage for active traders', 'Expanded review and analytics']
                : ['Unlimited analyses', 'Unlimited active strategies', 'Shared team-oriented workflows', 'Desk or organization coordination'];

          return (
            <article className={`marketing-card plan-card ${current ? 'current-plan' : ''}`} key={code}>
              <div className="plan-header">
                <p className="eyebrow">{code}{current ? ' · CURRENT PLAN' : ''}</p>
                <span className="plan-badge">{billingLabel}</span>
              </div>

              <h2 className="plan-price">{displayPrice}</h2>
              {code !== 'FREE' && <p className="muted pricing-subline">{billingInterval === 'annual' ? 'Save ~20% with annual billing' : 'Annual billing saves ~20%'}</p>}
              <p className="plan-promise">{pricing.summary}</p>

              <div className="plan-features">
                <ul>{features.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>

              {cta && <div className="button-row plan-cta-wrap">{cta}</div>}
            </article>
          );
        })}
      </section>

      <section className="marketing-section">
        <h2>What never changes with your plan</h2>
        <p>
          Rules remain visible, missing evidence never silently passes, AI does not override
          deterministic authorization, and no plan promises profit or a guaranteed outcome.
        </p>
      </section>

      <footer className="marketing-footer">
        <Link href="/">Home</Link>
        <Link href="/about">About</Link>
        <Link href="/faq">FAQ</Link>
        <Link href="/legal">Legal & risk</Link>
      </footer>
    </main>
  );
}
