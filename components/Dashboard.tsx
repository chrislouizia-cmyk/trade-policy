import OnboardingChecklist from '@/components/OnboardingChecklist';
import PrivateBetaCard from '@/components/PrivateBetaCard';
import type { Locale } from '@/lib/i18n/config';
import { workspaceText } from '@/lib/i18n/workspace-copy';
import DecisionStateGuide from '@/components/DecisionStateGuide';
import PoliceIntelligence from '@/components/PoliceIntelligence';
import type { LearningSummary } from '@/lib/trader-learning';

type Props = {
  displayName:string;
  account:{name:string;currency:string;current_balance:number|string}|null;
  strategy:{name:string}|null;
  openTrades:number;
  todayPnl:number;
  wins:number;
  losses:number;
  discipline:number|null;
  closedTradesToday:number;
  hasTrade:boolean;
  locale:Locale;
  intelligence:LearningSummary|null;
};

export default function Dashboard(p: Props) {
  const w=(text:string)=>workspaceText(p.locale,text);
  const setupComplete=Boolean(p.account&&p.strategy&&p.hasTrade);
  const hasOpenTrade=p.openTrades>0;
  return <div className="stack dashboard-shell">
    <section className="dashboard-welcome">
      <span className="eyebrow">{w('YOUR TRADING WORKSPACE')}</span>
      <h1>{w('Good morning')}, {p.displayName}.</h1>
      <p>{w('Your account, strategy and discipline in one place.')}</p>
    </section>
    <section className="dashboard-hero card command-center-hero">
      <div className="dashboard-hero-copy">
        <span className="eyebrow">{w('YOUR NEXT STEP')}</span>
        <h1>{hasOpenTrade?w('Review the trade you already took.'):w('Ready to check your next trade?')}</h1>
        <p>{hasOpenTrade?w('See whether your open trade still follows the plan.'):w('Choose a market and Trade Police will check it against your strategy.')}</p>
        <small>{w('You will get one clear answer: setup found, wait, or do not take it.')}</small>
      </div>
      <div className="dashboard-hero-actions"><a className="button-link primary dashboard-primary-action" href={hasOpenTrade?'/active-trade':'/validate'}>{hasOpenTrade?w('Review active trade'):w('Check a trade')}</a>{hasOpenTrade?<a className="button-link secondary dashboard-secondary-action" href="/validate">{w('Check another trade')}</a>:null}</div>
    </section>

    {p.intelligence&&<PoliceIntelligence summary={p.intelligence} locale={p.locale}/>}

    <div className="grid grid-4 metric-grid compact-dashboard-grid">
      <Card label={w('Active account')} value={p.account?p.account.name:w('Not configured')} sub={p.account?`${p.account.currency} ${Number(p.account.current_balance).toLocaleString(p.locale)}`:w('Create an account to calculate risk')} href="/accounts"/>
      <Card label={w('Active strategy')} value={p.strategy?.name??w('Not configured')} sub={p.strategy?w('Rules used for every new decision'):w('Choose or create your trading rules')} href="/profile"/>
      <Card label={w('Open trades')} value={String(p.openTrades)} sub={w('Under active supervision')} href="/active-trade"/>
      {p.closedTradesToday>0
        ? <Card label={w('Today')} value={`${p.todayPnl>=0?'+':''}$${p.todayPnl.toFixed(2)}`} sub={`${p.wins} ${w('wins')} · ${p.losses} ${w('losses')} · ${p.discipline}% ${w('rules followed')}`}/>
        : <Card label={w('Today')} value={w('No closed trades')} sub={w('Results appear after you close a recorded trade')}/>
      }
    </div>

    {!setupComplete&&<OnboardingChecklist hasAccount={Boolean(p.account)} hasStrategy={Boolean(p.strategy)} hasTrade={p.hasTrade} locale={p.locale}/>}
    <PrivateBetaCard />
    <details className="dashboard-mobile-disclosure">
      <summary>{w('How decisions work')}<span aria-hidden="true">›</span></summary>
      <DecisionStateGuide locale={p.locale}/>
    </details>

    <nav className="dashboard-secondary-links" aria-label={w('More tools')}><a href="/profile">{w('Strategies')}</a><a href="/analytics">{w('Performance')}</a><a href="/account">{w('Account and settings')}</a></nav>
  </div>;
}

function Card({label,value,sub,href}:{label:string;value:string;sub?:string;href?:string}){const body=<><span className="muted">{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</>;return href?<a className="card metric dashboard-card" href={href}>{body}</a>:<div className="card metric dashboard-card">{body}</div>}
