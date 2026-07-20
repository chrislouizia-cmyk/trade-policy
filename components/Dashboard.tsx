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
  const setupComplete=Boolean(p.account&&p.strategy&&p.hasTrade);
  return (
    <div className="stack">
      <section className="dashboard-hero card command-center-hero">
        <div className="dashboard-hero-copy">
          <span className="eyebrow">TRADE POLICE COMMAND CENTER</span>
          <h1>Institutional trading discipline.</h1>
          <p>Review the market, validate the setup, and keep the process consistent before any order is sent.</p>
          <small>Every trade remains under review until the evidence is clear.</small>
        </div>
        <a className="button-link primary dashboard-primary-action" href="/validate">Open validator</a>
      </section>

      {!setupComplete&&<OnboardingChecklist
        hasAccount={Boolean(p.account)}
        hasStrategy={Boolean(p.strategy)}
        hasTrade={p.hasTrade}
      />}

      <div className="grid grid-4 metric-grid compact-dashboard-grid">
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
          sub={`${p.wins} wins · ${p.losses} losses · ${p.discipline}% discipline`}
        />
      </div>

      <div className="card quick-actions">
        <div className="section-title">
          <div>
            <span className="eyebrow">NEXT MOVE</span>
            <h2>Workspace actions</h2>
          </div>
        </div>
        <div className="button-row">
          <a className="button-link secondary" href="/validate">Analyze market</a>
          <a className="button-link secondary" href="/active-trade">Review open trades</a>
          <a className="button-link secondary" href="/profile">Adjust strategy</a>
          <a className="button-link secondary" href="/analytics">Review analytics</a>
        </div>
      </div>

      <div className="card workspace-summary">
        <div className="section-title">
          <div>
            <span className="eyebrow">CURRENT VIEW</span>
            <h2>Signal discipline</h2>
          </div>
        </div>
        <div className="dashboard-footnotes">
          <div>
            <strong>Consistency over volume</strong>
            <p className="muted">The dashboard now keeps the focus on the active account, the strategy in control, and the next decision that needs attention.</p>
          </div>
          <div>
            <strong>Operational notes</strong>
            <ul>
              <li>Strategy switching updates the rules and instruments immediately.</li>
              <li>Feedback is tracked so beta issues can be resolved faster.</li>
              <li>Mobile strategy and analytics views remain available without crowding the workspace.</li>
            </ul>
          </div>
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
