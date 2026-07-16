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
    ['Customers', overview.total_customers ?? 0, `${overview.new_customers_30d ?? 0} new in 30 days`],
    ['Active customers', overview.active_customers_7d ?? 0, 'Activity in the last 7 days'],
    ['Analyses today', overview.analyses_today ?? 0, `${overview.failed_actions_today ?? 0} failed actions`],
    ['Open trades', overview.open_trades ?? 0, 'Across all customer accounts'],
    ['Strategies', overview.strategies ?? 0, 'Active, non-archived profiles'],
    ['Open feedback', overview.open_feedback ?? 0, `${overview.open_incidents ?? 0} system incidents`],
  ];

  return <div className="stack admin-shell">
    <section className="card admin-banner"><div><span className="eyebrow">OWNER CONTROL CENTER</span><h2>Business and system overview</h2><p className="muted">Customer metadata and operational health only. Private strategy rules and trade details remain hidden.</p></div><span className="status-pill healthy">Private</span></section>
    <div className="grid grid-3 metric-grid">{cards.map(([label,value,sub])=><div className="card metric admin-metric" key={String(label)}><span className="muted">{label}</span><strong>{value}</strong><small>{sub}</small></div>)}</div>
    <section className="card"><div className="section-title"><div><span className="eyebrow">CUSTOMERS</span><h2>Customer control</h2></div><span className="muted">No strategy content shown</span></div><div className="data-table"><div className="data-row data-head"><span>Customer</span><span>Plan</span><span>Strategies</span><span>Accounts</span><span>Analyses</span><span>Last activity</span></div>{customers.map(c=><div className="data-row" key={c.customer_id}><span><strong>{c.display_name || 'Unnamed customer'}</strong><small>{c.email || 'No email'}</small></span><span><span className="status-pill">{c.plan}</span><small>{c.subscription_status}</small></span><span>{c.strategy_count}</span><span>{c.account_count}</span><span>{c.analysis_count}</span><span>{c.last_activity_at?new Date(c.last_activity_at).toLocaleString():'No recorded activity'}</span></div>)}</div></section>
    <section className="card"><div className="section-title"><div><span className="eyebrow">SYSTEM HEALTH</span><h2>Recent private incidents</h2></div></div>{incidents.length===0?<div className="empty-state compact"><strong>No incidents recorded</strong><p className="muted">Provider failures and internal errors will appear here without exposing them to customers.</p></div>:incidents.map(i=><div className="event-row" key={i.id}><div><strong>{i.internal_code}</strong><small>{i.endpoint || 'Unknown endpoint'} · {i.provider || 'Internal'}</small></div><div><span className={`status-pill ${i.severity.toLowerCase()}`}>{i.severity}</span><small>{new Date(i.created_at).toLocaleString()}</small></div></div>)}</section>
  </div>;
}
