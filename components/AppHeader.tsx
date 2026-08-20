import ActiveStrategySwitcher from '@/components/ActiveStrategySwitcher';
import ActiveAccountSwitcher from '@/components/ActiveAccountSwitcher';
import FeedbackWidget from '@/components/FeedbackWidget';
import SignOutButton from '@/components/SignOutButton';
import TradePoliceShield from '@/components/TradePoliceShield';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import { createClient } from '@/lib/supabase/server';
import Image from 'next/image';
import Link from 'next/link';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
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
  const { count } = await supabase.from('active_trades').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'OPEN');
  const activeTradeCount = count ?? 0;

  return (
    <>
      <header className="app-shell-header client-header">
        <div className="client-greeting-row client-shell-top">
          <div className="client-greeting personal-greeting">
            <strong>{greeting()}, {displayName}.</strong>
            <small>{description}</small>
          </div>
          <div className="shell-header-actions">
            <TradePoliceShield />
          </div>
        </div>

        <div className="app-brand-row shell-brand-row">
          <Link href="/dashboard" className="app-brand" aria-label="Trade Police">
            <Image src="/brand/trade-police-logo.png" alt="Trade Police" width={220} height={46} className="brand-logo-wordmark brand-logo-header" />
            <span className="brand-caption">
              <small>No trade without evidence.</small>
            </span>
          </Link>
          <div className="app-user shell-user-controls">
            <KeyboardShortcuts />
            <SignOutButton />
          </div>
        </div>

        <nav className="primary-nav shell-primary-nav" aria-label="Primary navigation">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/validate">Decision</Link>
          <Link href="/active-trade">Active Trade{activeTradeCount > 0 ? <span className="nav-badge">{activeTradeCount}</span> : null}</Link>
          <Link href="/history">History</Link>
          <Link href="/account">Account</Link>
          <Link href="/profile">Strategies</Link>
          <Link href="/analytics">Analytics</Link>
        </nav>

        <div className="context-bar compact-context-bar">
          <div className="context-copy">
            <span className="eyebrow">{eyebrow}</span>
            <h1>Personal trading context</h1>
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
