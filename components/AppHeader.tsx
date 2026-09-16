import ActiveStrategySwitcher from '@/components/ActiveStrategySwitcher';
import ActiveAccountSwitcher from '@/components/ActiveAccountSwitcher';
import SignOutButton from '@/components/SignOutButton';
import TradePoliceShield from '@/components/TradePoliceShield';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import AppPrimaryNavigation from '@/components/AppPrimaryNavigation';
import Image from 'next/image';
import Link from 'next/link';
import { getServerTranslator } from '@/lib/i18n/server';

export default async function AppHeader({
  eyebrow,
  displayName,
  description,
  activeTradeCount = 0,
  decisionFocused = false,
  showContext = false,
}: {
  eyebrow: string;
  displayName: string;
  description: string;
  activeTradeCount?: number;
  decisionFocused?: boolean;
  showContext?: boolean;
}) {
  const { t } = await getServerTranslator();

  return (
    <>
      <header className={`app-shell-header client-header canonical-app-shell ${decisionFocused ? 'decision-focused-header' : ''}`}>
        <div className="canonical-shell-top">
          <Link href="/dashboard" className="app-brand canonical-shell-brand" aria-label="Trade Police">
            <Image
              src="/brand/trade-police-logo.png"
              alt="Trade Police"
              width={220}
              height={46}
              className="brand-logo-wordmark brand-logo-header"
            />
            <span className="brand-caption">
              <small>{t('brand.tagline') || 'No trade without evidence.'}</small>
            </span>
          </Link>

          <Link href="/dashboard" className="mobile-shell-brand" aria-label="Trade Police home">
            <Image
              src="/brand/trade-police-logo.png"
              alt="Trade Police"
              width={148}
              height={38}
            />
          </Link>

          <div className="app-user shell-user-controls canonical-shell-user" title={displayName}>
            <TradePoliceShield />
            <KeyboardShortcuts />
            <SignOutButton />
          </div>
        </div>

        <AppPrimaryNavigation activeTradeCount={activeTradeCount} />

        {showContext ? (
          <details className="context-bar compact-context-bar canonical-context-bar" open={decisionFocused || undefined}>
            <summary className="mobile-context-summary">
              <span>Trading context</span>
              <small>{decisionFocused ? 'Ready to change' : 'Tap to change'}</small>
              <b aria-hidden="true">⌄</b>
            </summary>
            <div className="context-copy canonical-context-copy">
              <span className="eyebrow">{eyebrow}</span>
              <small>{description}</small>
            </div>
            <div className="context-switchers compact-switchers canonical-context-switchers">
              <ActiveAccountSwitcher />
              <ActiveStrategySwitcher />
            </div>
          </details>
        ) : null}
      </header>

    </>
  );
}
