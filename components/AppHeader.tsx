import ActiveStrategySwitcher from '@/components/ActiveStrategySwitcher';
import ActiveAccountSwitcher from '@/components/ActiveAccountSwitcher';
import FeedbackWidget from '@/components/FeedbackWidget';
import SignOutButton from '@/components/SignOutButton';
import TradePoliceShield from '@/components/TradePoliceShield';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import { createClient } from '@/lib/supabase/server';
import Image from 'next/image';
import Link from 'next/link';
import { getServerTranslator } from '@/lib/i18n/server';

function greeting(hour: number, t: (key: 'greeting.morning' | 'greeting.afternoon' | 'greeting.evening') => string) {
  if (hour < 12) return t('greeting.morning') || 'Good morning';
  if (hour < 18) return t('greeting.afternoon') || 'Good afternoon';
  return t('greeting.evening') || 'Good evening';
}

export default async function AppHeader({
  eyebrow,
  displayName,
  description,
  userId,
}: {
  eyebrow: string;
  displayName: string;
  description: string;
  userId: string;
}) {
  const supabase = await createClient();
  const { t } = await getServerTranslator();
  const { count } = await supabase.from('active_trades').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'OPEN');
  const activeTradeCount = count ?? 0;

  return (
    <>
      <header className="app-shell-header client-header">
        <div className="app-brand-row shell-brand-row">
          <Link href="/dashboard" className="app-brand" aria-label="Trade Police">
            <Image src="/brand/trade-police-logo.png" alt="Trade Police" width={220} height={46} className="brand-logo-wordmark brand-logo-header" />
            <span className="brand-caption">
              <small>{t('brand.tagline') || 'No trade without evidence.'}</small>
            </span>
          </Link>
          <div className="app-user shell-user-controls">
            <TradePoliceShield />
            <KeyboardShortcuts />
            <SignOutButton />
          </div>
        </div>

        <div className="client-greeting-row client-shell-top">
          <div className="client-greeting personal-greeting">
            <strong>{greeting(new Date().getHours(), t)}, {displayName}.</strong>
            <small>{description}</small>
          </div>
        </div>

        <nav className="primary-nav shell-primary-nav" aria-label={t('nav.primary')}>
          <Link href="/dashboard">{t('nav.dashboard')}</Link>
          <Link href="/validate">{t('nav.decision')}</Link>
          <Link href="/active-trade">{t('nav.activeTrade') || 'Active Trade'}{activeTradeCount > 0 ? <span className="nav-badge">{activeTradeCount}</span> : null}</Link>
          <Link href="/history">{t('nav.history')}</Link>
          <Link href="/accounts">{t('nav.tradingAccounts')}</Link>
          <Link href="/account">{t('nav.account')}</Link>
          <Link href="/profile">{t('nav.strategies')}</Link>
          <Link href="/analytics">{t('nav.analytics')}</Link>
        </nav>

        <div className="context-bar compact-context-bar">
          <div className="context-copy">
            <span className="eyebrow">{eyebrow}</span>
            <h1>{t('header.context')}</h1>
          </div>
          <div className="context-switchers compact-switchers">
            <ActiveAccountSwitcher />
            <ActiveStrategySwitcher />
          </div>
        </div>
      </header>
      <FeedbackWidget userId={userId} />
    </>
  );
}
