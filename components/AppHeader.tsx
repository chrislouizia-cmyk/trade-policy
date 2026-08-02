import ActiveStrategySwitcher from '@/components/ActiveStrategySwitcher';
import ActiveAccountSwitcher from '@/components/ActiveAccountSwitcher';
import FeedbackWidget from '@/components/FeedbackWidget';
import SignOutButton from '@/components/SignOutButton';
import TradePoliceShield from '@/components/TradePoliceShield';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import Link from 'next/link';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function AppHeader({
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
  return (
    <>
      <header className="app-shell-header client-header">
        <div className="client-greeting-row">
          <div className="client-greeting">
            <strong>{greeting()}, {displayName}.</strong>
            <small>{description}</small>
          </div>
          <TradePoliceShield />
        </div>

        <div className="app-brand-row">
          <Link href="/dashboard" className="app-brand">
            <span className="brand-mark">TP</span>
            <span>
              <strong>Trade Police</strong>
              <small>No trade without evidence.</small>
            </span>
          </Link>
          <div className="app-user">
            <KeyboardShortcuts />
            <SignOutButton />
          </div>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/validate">Decision</Link>
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
