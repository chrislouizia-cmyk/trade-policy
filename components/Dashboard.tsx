import OnboardingChecklist from '@/components/OnboardingChecklist';

type Props = {
  displayName: string;
  account: any;
  strategy: any;
  openTrades: number;
  todayPnl: number;
  wins: number;
  losses: number;
  discipline: number;
  hasTrade: boolean;
};

export default function Dashboard(p: Props) {
  return (
    <div className="stack">
      <section className="dashboard-hero card command-center-hero">
        <div className="dashboard-hero-copy">
          <span className="eyebrow">TRADE POLICE COMMAND CENTER</span>
          <h1>Analyze the market.</h1>
          <p>Validate the setup against your active account, strategy and rules before execution.</p>
          <small>Protect the process. Every trade must earn permission.</small>
        </div>
        <a className="button-link primary dashboard-primary-action" href="/validate">Analyze market</a>
      </section>

      <OnboardingChecklist
        hasAccount={Boolean(p.account)}
        hasStrategy={Boolean(p.strategy)}
        hasTrade={p.hasTrade}
      />

      <div className="grid grid-3 metric-grid compact-dashboard-grid">
        <Card
          label="Active account"
          value={p.account ? p.account.name : 'Not configured'}
          sub={p.account
            ? `${p.account.currency} ${Number(p.account.current_balance).toLocaleString()}`
            : 'Create an account to calculate risk'}
          href="/accounts"
        />
        <Card
          label="Active strategy"
          value={p.strategy?.name ?? 'Not configured'}
          sub={p.strategy ? 'Controls new validations' : 'Build or activate a strategy'}
          href="/profile"
        />
        <Card label="Open trades" value={String(p.openTrades)} sub="Under active supervision" href="/active-trade" />
        <Card
          label="Today"
          value={`${p.todayPnl >= 0 ? '+' : ''}$${p.todayPnl.toFixed(2)}`}
          sub={`${p.wins} wins · ${p.losses} losses`}
        />
        <Card label="Discipline score" value={`${p.discipline}%`} sub="Following Trade Police verdicts" />
        <Card label="Performance" value="View analytics" sub="Review behavior and results" href="/analytics" />
      </div>

      <div className="card quick-actions">
        <div className="section-title">
          <div>
            <span className="eyebrow">NEXT MOVE</span>
            <h2>Quick actions</h2>
          </div>
        </div>
        <div className="button-row">
          <a className="button-link primary" href="/validate">Analyze market</a>
          <a className="button-link secondary" href="/active-trade">Open trades</a>
          <a className="button-link secondary" href="/profile">Switch strategy</a>
          <a className="button-link secondary" href="/analytics">View performance</a>
        </div>
      </div>

      <div className="grid grid-2 dashboard-footer-grid">
        <div className="card release-notes-card">
          <span className="eyebrow">WHAT'S NEW</span>
          <h2>Portal separation and HQ controls</h2>
          <ul>
            <li>Customer workspace no longer exposes Trade Police HQ.</li>
            <li>HQ uses a dedicated portal and role-specific workspaces.</li>
            <li>Owners can control staff permissions individually.</li>
          </ul>
          <small className="muted">v1.0 Founders Edition</small>
        </div>

        <div className="card disclaimer">
          <strong>Beta disclaimer</strong>
          <p className="muted">
            Trade Police is a decision-support and discipline tool, not financial advice.
            You remain responsible for every trade and loss.
          </p>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, sub, href }:{ label:string; value:string; sub?:string; href?:string }) {
  const body = <><span className="muted">{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</>;
  return href
    ? <a className="card metric dashboard-card" href={href}>{body}</a>
    : <div className="card metric dashboard-card">{body}</div>;
}
