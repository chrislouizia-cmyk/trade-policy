import OnboardingChecklist from '@/components/OnboardingChecklist';
import PrivateBetaCard from '@/components/PrivateBetaCard';

type Props = {
  displayName: string;
  account: any;
  strategy: any;
  openTrades: number;
  todayPnl: number;
  wins: number;
  losses: number;
  discipline: number | null;
  closedTradesToday: number;
  hasTrade: boolean;
};

export default function Dashboard(p: Props) {
  const setupComplete=Boolean(p.account&&p.strategy&&p.hasTrade);
  return (
    <div className="stack dashboard-shell">
      <section className="dashboard-hero card command-center-hero">
        <div className="dashboard-hero-copy">
          <div className="dashboard-hero-meta">
            <span className="status-pill info">Live workspace</span>
          </div>
          <span className="eyebrow">TRADE POLICE COMMAND CENTER</span>
          <h1>Make the next decision with your rules in view.</h1>
          <p>Check current market evidence, run the final risk check, and understand exactly why the result passed or stopped.</p>
          <small>Every trade remains under review until the evidence is clear.</small>
        </div>
        <div className="dashboard-hero-actions">
          <a className="button-link primary dashboard-primary-action" href="/validate">Check a setup</a>
          <a className="button-link secondary dashboard-secondary-action" href="/active-trade">Review active trade</a>
        </div>
      </section>

      {!setupComplete&&<OnboardingChecklist
        hasAccount={Boolean(p.account)}
        hasStrategy={Boolean(p.strategy)}
        hasTrade={p.hasTrade}
      />}

      <PrivateBetaCard />

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
          sub={p.strategy ? 'Rules used for every new decision' : 'Choose or create your trading rules'}
          href="/profile"
        />
        <Card label="Open trades" value={String(p.openTrades)} sub="Under active supervision" href="/active-trade" />
        {p.closedTradesToday>0?<Card label="Today" value={`${p.todayPnl >= 0 ? '+' : ''}$${p.todayPnl.toFixed(2)}`} sub={`${p.wins} wins · ${p.losses} losses · ${p.discipline}% rules followed`}/>:<Card label="Today" value="No closed trades" sub="Results appear after you close a recorded trade"/>}
      </div>

      <div className="card quick-actions">
        <div className="section-title">
          <div>
            <span className="eyebrow">NEXT MOVE</span>
            <h2>Workspace actions</h2>
          </div>
        </div>
        <div className="button-row">
          <a className="button-link secondary" href="/validate">Check a setup</a>
          <a className="button-link secondary" href="/active-trade">Review open trades</a>
          <a className="button-link secondary" href="/profile">Edit trading rules</a>
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
