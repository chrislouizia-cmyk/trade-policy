import Link from "next/link";
import SystemHealth from "@/components/hq/SystemHealth";

type Metrics = {
  totalCustomers?: number;
  newCustomers30d?: number;
  activeCustomers7d?: number;
  analysesToday?: number;
  openTrades?: number;
  activeStrategies?: number;
  openSupport?: number;
  openFeedback?: number;
  openCompliance?: number;
  openIncidents?: number;
  failedActionsToday?: number;
  overdueFollowUps?: number;
};
type WorkItem = {
  kind: string;
  id?: string;
  priority?: string;
  title: string;
  detail?: string;
  occurredAt: string;
  dueAt?: string | null;
  href: string;
};
type CommandCenter = {
  generatedAt: string;
  metrics: Metrics;
  attention: WorkItem[];
  activity: WorkItem[];
};
type Customer = {
  customer_id: string;
  email: string | null;
  display_name: string | null;
  plan: string | null;
  subscription_status: string | null;
  active_strategy: string | null;
  account_count: number;
  analysis_count: number;
  last_activity_at: string | null;
};
type Metric = {label:string;value:number|undefined;sub:string;href:string;tone?:"attention"};

const human=(value:string)=>value.replaceAll("_"," ").toLowerCase().replace(/\b\w/g,letter=>letter.toUpperCase());
const timestamp=(value:string|null|undefined)=>value?new Date(value).toLocaleString():"Not recorded";
const number=(value:unknown)=>typeof value==="number"?value:0;

function MetricCard({metric}:{metric:Metric}){
  const available=typeof metric.value==="number";
  return <Link className={`hq-command-metric${metric.tone?` ${metric.tone}`:""}`} href={metric.href}>
    <span>{metric.label}</span>
    <strong>{available?metric.value:"—"}</strong>
    <small>{available?metric.sub:"Data source unavailable"}</small>
  </Link>;
}

function Queue({items}:{items:WorkItem[]}){
  if(!items.length)return <div className="hq-command-empty"><strong>No urgent work is waiting.</strong><span>New cross-department exceptions will appear here.</span></div>;
  return <div className="hq-command-queue">{items.map((item,index)=><Link href={item.href} className="hq-command-row" key={`${item.kind}-${item.id??index}`}>
    <span className={`hq-command-kind ${item.priority?.toLowerCase()??""}`}>{human(item.kind)}</span>
    <div><strong>{item.title}</strong><small>{item.detail||"No additional context"}</small></div>
    <div className="hq-command-time"><b>{human(item.priority||"Review")}</b><time>{item.dueAt?`Due ${timestamp(item.dueAt)}`:timestamp(item.occurredAt)}</time></div>
    <span aria-hidden="true">→</span>
  </Link>)}</div>;
}

function Activity({items}:{items:WorkItem[]}){
  if(!items.length)return <div className="hq-command-empty"><strong>No company activity recorded.</strong><span>Customer and authorized staff events will appear here.</span></div>;
  return <div className="hq-command-activity">{items.map((item,index)=><Link href={item.href} key={`${item.kind}-${item.occurredAt}-${index}`}>
    <span aria-hidden="true" />
    <div><strong>{human(item.title)}</strong><small>{item.detail||human(item.kind)}</small></div>
    <time>{timestamp(item.occurredAt)}</time>
  </Link>)}</div>;
}

export default function AdminDashboard({commandCenter,customers,permissions,loadError}:{commandCenter:CommandCenter|null;customers:Customer[];permissions:string[];loadError:string|null}){
  const can=(permission:string)=>permissions.includes(permission);
  const metrics=commandCenter?.metrics??{};
  const primary:Metric[]=[
    {label:"Total customers",value:metrics.totalCustomers,sub:`${number(metrics.newCustomers30d)} joined in 30 days`,href:"/hq/customers"},
    {label:"Active customers",value:metrics.activeCustomers7d,sub:"Used Trade Police in 7 days",href:"/hq/customers?sort=last_activity"},
    {label:"Analyses today",value:metrics.analysesToday,sub:"Canonical analysis events",href:"/hq/system"},
    {label:"Open trades",value:metrics.openTrades,sub:"Canonical active-trade records",href:"/hq/system"},
    {label:"Active strategies",value:metrics.activeStrategies,sub:"Non-archived customer strategies",href:"/hq/system/strategy-compatibility?status=ACTIVE"},
  ];
  const attention:Metric[]=[
    {label:"Support",value:metrics.openSupport,sub:"Open or waiting for customer",href:"/hq/support",tone:"attention"},
    {label:"Compliance",value:metrics.openCompliance,sub:"Unresolved review cases",href:"/hq/compliance/cases",tone:"attention"},
    {label:"Incidents",value:metrics.openIncidents,sub:"Unresolved operational incidents",href:"/hq/system/queue?status=OPEN",tone:"attention"},
    {label:"Overdue follow-ups",value:metrics.overdueFollowUps,sub:"Sales follow-ups past due",href:"/hq/sales",tone:"attention"},
  ];
  const departments=[
    {name:"Customers",detail:`${number(metrics.totalCustomers)} total · ${number(metrics.activeCustomers7d)} active in 7 days`,href:"/hq/customers",permission:"customers.view_metadata"},
    {name:"Sales",detail:`${number(metrics.overdueFollowUps)} overdue follow-ups`,href:"/hq/sales",permission:"sales.view"},
    {name:"Support",detail:`${number(metrics.openSupport)} tickets · ${number(metrics.openFeedback)} feedback items`,href:"/hq/support",permission:"support.view"},
    {name:"Compliance",detail:`${number(metrics.openCompliance)} unresolved cases`,href:"/hq/compliance",permission:"compliance.view"},
    {name:"System operations",detail:`${number(metrics.openIncidents)} incidents · ${number(metrics.failedActionsToday)} failures today`,href:"/hq/system",permission:"system.health"},
  ].filter(item=>can(item.permission));

  return <main className="hq-command-center">
    <header className="hq-command-hero">
      <div><span className="eyebrow">EXECUTIVE OPERATIONS</span><h1>Company command center</h1><p>One verified view of customer activity, company workload, and operating health.</p></div>
      <div className="hq-command-freshness"><span>DATA SNAPSHOT</span><strong>{commandCenter?timestamp(commandCenter.generatedAt):"Unavailable"}</strong><small>Live operational records · not estimated</small></div>
    </header>

    {loadError&&<div className="hq-command-error" role="alert"><strong>Command center unavailable</strong><span>{loadError}</span><Link href="/hq">Retry</Link></div>}

    <section className="hq-command-section" aria-labelledby="company-pulse-title">
      <div className="hq-command-heading"><div><span className="eyebrow">COMPANY PULSE</span><h2 id="company-pulse-title">What is happening now</h2></div><Link href="/hq/system">Open operational detail</Link></div>
      <div className="hq-command-metric-grid primary">{primary.map(metric=><MetricCard metric={metric} key={metric.label}/>)}</div>
      <div className="hq-command-metric-grid attention">{attention.map(metric=><MetricCard metric={metric} key={metric.label}/>)}</div>
    </section>

    <div className="hq-command-main-grid">
      <section className="card hq-command-panel">
        <div className="hq-command-heading"><div><span className="eyebrow">NEEDS ATTENTION</span><h2>Executive action queue</h2></div><small>Prioritized across departments</small></div>
        <Queue items={commandCenter?.attention??[]}/>
      </section>
      <section className="card hq-command-panel">
        <div className="hq-command-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Company timeline</h2></div><small>Customers and authorized staff</small></div>
        <Activity items={commandCenter?.activity??[]}/>
      </section>
    </div>

    {can("customers.view_metadata")&&<section className="card hq-command-panel">
      <div className="hq-command-heading"><div><span className="eyebrow">CUSTOMER PULSE</span><h2>Recently active customers</h2></div><Link href="/hq/customers">Open directory</Link></div>
      {customers.length?<div className="hq-command-customers">{customers.map(customer=><Link href={`/hq/customers/${customer.customer_id}`} key={customer.customer_id}>
        <div><strong>{customer.display_name||"Unnamed customer"}</strong><small>{customer.email||"No email"}</small></div>
        <span>{human(customer.plan||"Not assigned")}</span>
        <div><strong>{customer.active_strategy||"No active strategy"}</strong><small>{customer.account_count} accounts · {customer.analysis_count} analyses</small></div>
        <time>{timestamp(customer.last_activity_at)}</time><b>{human(customer.subscription_status||"Unknown")}</b>
      </Link>)}</div>:<div className="hq-command-empty"><strong>No customers found.</strong><span>Customer records appear after signup.</span></div>}
    </section>}

    <section className="hq-command-section">
      <div className="hq-command-heading"><div><span className="eyebrow">DEPARTMENTS</span><h2>Operating workspaces</h2></div><small>Permission-scoped destinations</small></div>
      <div className="hq-command-departments">{departments.map(item=><Link href={item.href} key={item.name}><strong>{item.name}</strong><span>{item.detail}</span><b>Open →</b></Link>)}</div>
    </section>

    {can("system.health")&&<SystemHealth/>}
  </main>;
}
