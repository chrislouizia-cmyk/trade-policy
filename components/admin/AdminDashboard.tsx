'use client';

type Overview = {
  total_customers?: number;
  new_customers_30d?: number;
  active_customers_7d?: number;
  analyses_today?: number;
  failed_actions_today?: number;
  open_trades?: number;
  strategies?: number;
  open_feedback?: number;
  open_incidents?: number;
  plans?: Record<string, number>;
};

type Customer = {
  customer_id: string;
  email: string | null;
  display_name: string | null;
  plan: string;
  subscription_status: string;
  created_at: string;
  strategy_count: number;
  account_count: number;
  analysis_count: number;
  last_activity_at: string | null;
};

type Incident = {
  id: number;
  public_code: string;
  internal_code: string;
  provider: string | null;
  endpoint: string | null;
  severity: string;
  message: string | null;
  created_at: string;
};

export default function AdminDashboard({ overview, customers, incidents }:{ overview:Overview; customers:Customer[]; incidents:Incident[] }) {
  const cards = [
    {label:'Customers',value:overview.total_customers ?? 0,sub:`${overview.new_customers_30d ?? 0} new this month`,tone:'blue'},
    {label:'Active this week',value:overview.active_customers_7d ?? 0,sub:'Customers with recent activity',tone:'green'},
    {label:'Analyses today',value:overview.analyses_today ?? 0,sub:`${overview.failed_actions_today ?? 0} require attention`,tone:'violet'},
    {label:'Trades supervised',value:overview.open_trades ?? 0,sub:'Open across customer accounts',tone:'amber'},
    {label:'Strategies',value:overview.strategies ?? 0,sub:'Active customer playbooks',tone:'slate'},
    {label:'Needs attention',value:(overview.open_feedback ?? 0)+(overview.open_incidents ?? 0),sub:`${overview.open_feedback ?? 0} feedback · ${overview.open_incidents ?? 0} incidents`,tone:'red'},
  ];

  const recentCustomers = customers.slice(0,8);
  const urgent = incidents.filter(i=>['CRITICAL','HIGH'].includes(i.severity.toUpperCase())).length;

  return <div className="hq-dashboard-premium">
    <section className="hq-page-heading">
      <div><span className="eyebrow">MISSION CONTROL</span><h1>Good to see you, Chris.</h1><p>Business performance, customer activity and system health — without exposing private trading strategies.</p></div>
      <div className="hq-heading-actions"><a className="secondary-button" href="/hq/team">Manage team</a><a className="primary button-link" href="/hq/customers">View customers</a></div>
    </section>

    <section className="hq-priority-strip">
      <div><span className={`hq-health-dot ${urgent?'warning':'healthy'}`}/><span><strong>{urgent ? `${urgent} priority items` : 'Operations healthy'}</strong><small>{urgent ? 'Review high-severity incidents' : 'No high-severity incidents detected'}</small></span></div>
      <a href="/hq/system">Open system health →</a>
    </section>

    <div className="hq-kpi-grid">
      {cards.map(card=><article className={`hq-kpi-card tone-${card.tone}`} key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.sub}</small></article>)}
    </div>

    <div className="hq-dashboard-grid">
      <section className="hq-surface hq-customer-panel">
        <div className="hq-section-header"><div><span className="eyebrow">CUSTOMERS</span><h2>Recent customer activity</h2></div><a href="/hq/customers">View all →</a></div>
        {recentCustomers.length===0?<div className="empty-state compact"><strong>No customers yet</strong><p className="muted">New customer accounts will appear here.</p></div>:<div className="hq-customer-list">
          {recentCustomers.map(c=><div className="hq-customer-row" key={c.customer_id}>
            <span className="hq-avatar small">{(c.display_name||c.email||'?').slice(0,1).toUpperCase()}</span>
            <span className="hq-customer-name"><strong>{c.display_name||'Unnamed customer'}</strong><small>{c.email||'No email'}</small></span>
            <span><strong>{c.plan}</strong><small>{c.subscription_status}</small></span>
            <span><strong>{c.analysis_count}</strong><small>analyses</small></span>
            <span><small>{c.last_activity_at?new Date(c.last_activity_at).toLocaleDateString():'No activity'}</small></span>
          </div>)}
        </div>}
      </section>

      <aside className="hq-surface hq-priorities-panel">
        <div className="hq-section-header"><div><span className="eyebrow">TODAY</span><h2>Owner priorities</h2></div></div>
        <a href="/hq/system"><span>System incidents</span><strong>{overview.open_incidents??0}</strong></a>
        <a href="/hq/support"><span>Feedback waiting</span><strong>{overview.open_feedback??0}</strong></a>
        <a href="/hq/team"><span>Team access</span><strong>Review</strong></a>
        <a href="/hq/compliance"><span>Compliance</span><strong>Open</strong></a>
      </aside>
    </div>

    <section className="hq-surface">
      <div className="hq-section-header"><div><span className="eyebrow">SYSTEM HEALTH</span><h2>Recent private incidents</h2></div><a href="/hq/system">View health →</a></div>
      {incidents.length===0?<div className="empty-state compact"><strong>All systems clear</strong><p className="muted">Provider failures and internal errors stay private and will appear here.</p></div>:incidents.slice(0,8).map(i=><div className="hq-incident-row" key={i.id}><span className={`hq-health-dot ${i.severity.toLowerCase()}`}/><span><strong>{i.internal_code}</strong><small>{i.endpoint||'Unknown endpoint'} · {i.provider||'Internal'}</small></span><span className={`status-pill ${i.severity.toLowerCase()}`}>{i.severity}</span><small>{new Date(i.created_at).toLocaleString()}</small></div>)}
    </section>
  </div>;
}
