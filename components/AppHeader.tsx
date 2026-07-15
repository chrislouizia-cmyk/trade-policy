import ActiveStrategySwitcher from '@/components/ActiveStrategySwitcher';
import ActiveAccountSwitcher from '@/components/ActiveAccountSwitcher';
import FeedbackWidget from '@/components/FeedbackWidget';
import SignOutButton from '@/components/SignOutButton';
import TradePoliceShield from '@/components/TradePoliceShield';

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
          <a href="/" className="app-brand">
            <span className="brand-mark">TP</span>
            <span>
              <strong>Trade Police</strong>
              <small>No trade without evidence.</small>
            </span>
          </a>
          <div className="app-user">
            <SignOutButton />
          </div>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          <a href="/">Dashboard</a>
          <a href="/validate">Validate</a>
          <a href="/active-trade">Active trades</a>
          <a href="/accounts">Accounts</a>
          <a href="/profile">Strategies</a>
          <a href="/analytics">Analytics</a>
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
