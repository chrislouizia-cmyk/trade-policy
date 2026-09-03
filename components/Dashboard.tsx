import OnboardingChecklist from '@/components/OnboardingChecklist';
import PrivateBetaCard from '@/components/PrivateBetaCard';
import type { Locale } from '@/lib/i18n/config';
import { workspaceText } from '@/lib/i18n/workspace-copy';

type Props = { displayName:string; account:any; strategy:any; openTrades:number; todayPnl:number; wins:number; losses:number; discipline:number|null; closedTradesToday:number; hasTrade:boolean; locale:Locale };

export default function Dashboard(p: Props) {
  const w=(text:string)=>workspaceText(p.locale,text);
  const setupComplete=Boolean(p.account&&p.strategy&&p.hasTrade);
  return <div className="stack dashboard-shell">
    <section className="dashboard-hero card command-center-hero">
      <div className="dashboard-hero-copy">
        <div className="dashboard-hero-meta"><span className="status-pill info">{w('Live workspace')}</span></div>
        <span className="eyebrow">{w('TRADE POLICE COMMAND CENTER')}</span>
        <h1>{w('Make the next decision with your rules in view.')}</h1>
        <p>{w('Check current market evidence, run the final risk check, and understand exactly why the result passed or stopped.')}</p>
        <small>{w('Every trade remains under review until the evidence is clear.')}</small>
      </div>
      <div className="dashboard-hero-actions"><a className="button-link primary dashboard-primary-action" href="/validate">{w('Check a setup')}</a><a className="button-link secondary dashboard-secondary-action" href="/active-trade">{w('Review active trade')}</a></div>
    </section>

    {!setupComplete&&<OnboardingChecklist hasAccount={Boolean(p.account)} hasStrategy={Boolean(p.strategy)} hasTrade={p.hasTrade} locale={p.locale}/>}
    <PrivateBetaCard />

    <div className="grid grid-4 metric-grid compact-dashboard-grid">
      <Card label={w('Active account')} value={p.account?p.account.name:w('Not configured')} sub={p.account?`${p.account.currency} ${Number(p.account.current_balance).toLocaleString(p.locale)}`:w('Create an account to calculate risk')} href="/accounts"/>
      <Card label={w('Active strategy')} value={p.strategy?.name??w('Not configured')} sub={p.strategy?w('Rules used for every new decision'):w('Choose or create your trading rules')} href="/profile"/>
      <Card label={w('Open trades')} value={String(p.openTrades)} sub={w('Under active supervision')} href="/active-trade"/>
      {p.closedTradesToday>0?<Card label={w('Today')} value={`${p.todayPnl>=0?'+':''}$${p.todayPnl.toFixed(2)}`} sub={`${p.wins} ${w('wins')} · ${p.losses} ${w('losses')} · ${p.discipline}% ${w('rules followed')}`}/>:<Card label={w('Today')} value={w('No closed trades')} sub={w('Results appear after you close a recorded trade')}/>}
    </div>

    <div className="card quick-actions">
      <div className="section-title"><div><span className="eyebrow">{w('NEXT MOVE')}</span><h2>{w('Workspace actions')}</h2></div></div>
      <div className="button-row"><a className="button-link secondary" href="/validate">{w('Check a setup')}</a><a className="button-link secondary" href="/active-trade">{w('Review open trades')}</a><a className="button-link secondary" href="/profile">{w('Edit trading rules')}</a><a className="button-link secondary" href="/accounts">{w('Manage trading accounts')}</a><a className="button-link secondary" href="/analytics">{w('Review analytics')}</a></div>
    </div>

    <div className="card workspace-summary">
      <div className="section-title"><div><span className="eyebrow">{w('CURRENT VIEW')}</span><h2>{w('Signal discipline')}</h2></div></div>
      <div className="dashboard-footnotes"><div><strong>{w('Consistency over volume')}</strong><p className="muted">{w('The dashboard now keeps the focus on the active account, the strategy in control, and the next decision that needs attention.')}</p></div><div><strong>{w('Operational notes')}</strong><ul><li>{w('Strategy switching updates the rules and instruments immediately.')}</li><li>{w('Feedback is tracked so beta issues can be resolved faster.')}</li><li>{w('Mobile strategy and analytics views remain available without crowding the workspace.')}</li></ul></div></div>
    </div>
  </div>;
}

function Card({label,value,sub,href}:{label:string;value:string;sub?:string;href?:string}){const body=<><span className="muted">{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</>;return href?<a className="card metric dashboard-card" href={href}>{body}</a>:<div className="card metric dashboard-card">{body}</div>}
