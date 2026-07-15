type Overview=Record<string,string|number|boolean|null>;

type WorkspaceConfig={
  title:string;
  description:string;
  mission:string;
  cards:[string,string,string][];
  capabilities:string[];
  restrictions:string[];
};

const roleCopy:Record<string,WorkspaceConfig>={
  HEAD_OF_SALES:{
    title:'Sales Workspace',
    description:'Grow trials and conversions without exposing private trading activity.',
    mission:'Turn qualified interest into long-term Trade Police customers.',
    cards:[['New customers','new_customers_30d','Joined in the last 30 days'],['Trial customers','trial_customers','Currently evaluating Trade Police'],['Active subscriptions','active_subscriptions','Customers with active access'],['Open leads','open_leads','Require follow-up'],['Converted leads','converted_leads','Successfully converted']],
    capabilities:['View customer identity, plan and account status metadata','Review the sales pipeline and follow-up queue','Create and update leads','Track trials, conversions and plan summaries'],
    restrictions:['No access to customer strategies or rule logic','No access to trade screenshots, journals or balances','No access to system keys, prompts or infrastructure'],
  },
  COMPLIANCE_OFFICER:{
    title:'Compliance Workspace',
    description:'Review policy events and audit evidence with least-privilege access.',
    mission:'Protect customers and the company through consistent, documented review.',
    cards:[['Open cases','open_cases','Awaiting or under review'],['High priority','high_priority','High or critical severity'],['Open incidents','open_incidents','Unresolved system or policy events'],['Audit events · 7d','audit_events_7d','Administrative actions recorded this week']],
    capabilities:['View compliance cases and audit metadata','Review policy flags and documented incidents','Resolve assigned compliance cases','Suspend accounts only when explicitly permitted'],
    restrictions:['No access to proprietary strategy logic','No access to credentials or API keys','No access to sales revenue or unrelated support notes'],
  },
  SECURITY_ADMIN:{
    title:'Security Workspace',
    description:'Monitor privileged activity, security events and staff access.',
    mission:'Protect the platform through least privilege, auditability and rapid response.',
    cards:[['Open cases','open_cases','Security or compliance review'],['High priority','high_priority','Requires urgent attention'],['Open incidents','open_incidents','Unresolved operational events'],['Audit events · 7d','audit_events_7d','Recent privileged activity']],
    capabilities:['Review staff access and audit trails','Review compliance and security incidents','View system health when assigned','Verify that privileged access is justified'],
    restrictions:['No automatic access to customer strategy content','No access to passwords or secret values','No permission changes unless explicitly granted'],
  },
  SUPPORT:{
    title:'Support Workspace',
    description:'Resolve customer problems using only the metadata required to help.',
    mission:'Restore a smooth customer experience without invading customer privacy.',
    cards:[['Open tickets','open_tickets','Need a response'],['Assigned to me','assigned_to_me','Your active queue'],['Open feedback','open_feedback','Bug reports and suggestions'],['Customers','customers','Customer profiles available for support']],
    capabilities:['View customer contact, plan and account-status metadata','Review assigned support tickets and public error codes','Respond to feedback and update ticket status','Help customers with onboarding and access issues'],
    restrictions:['No access to private strategies, balances or detailed trades','No access to prompts, provider configuration or database tools','No permission to alter customer trading records'],
  },
  TECHNICIAN:{
    title:'System Health Workspace',
    description:'Operational telemetry and failures without private customer content.',
    mission:'Keep Trade Police reliable, fast and available.',
    cards:[['Open incidents','open_incidents','Unresolved operational issues'],['Critical incidents','critical_incidents','Immediate action required'],['Failed actions today','failed_actions_today','Private technical failures'],['Analyses today','analyses_today','Market and chart analyses processed']],
    capabilities:['View provider health, latency and incident summaries','Review sanitized error codes and affected endpoints','Monitor analysis volume and failure rate','Support technical incident resolution'],
    restrictions:['No access to customer strategy rules or journals','No display of secret values or credentials','No customer balance or billing access'],
  },
};

export default function WorkspaceDashboard({overview,role}:{overview:Overview;role:string}){
  const c=roleCopy[role]??{
    title:'Trade Police HQ',description:'Role-specific company workspace.',mission:'Operate Trade Police with clarity and accountability.',cards:[],capabilities:[],restrictions:[]
  };
  return <div className="stack hq-workspace">
    <section className="card hq-hero-card">
      <div><span className="eyebrow">ROLE WORKSPACE</span><h1>{c.title}</h1><p>{c.description}</p></div>
      <div className="hq-mission"><small>MISSION</small><strong>{c.mission}</strong></div>
    </section>

    <div className="grid grid-3 metric-grid hq-metric-grid">
      {c.cards.map(([label,key,sub])=><div className="card metric hq-metric" key={key}><span className="muted">{label}</span><strong>{String(overview[key]??0)}</strong><small>{sub}</small></div>)}
    </div>

    <div className="grid grid-2 hq-access-grid">
      <section className="card access-card allowed-access"><span className="eyebrow">YOU CAN</span><h2>Your available tools</h2><ul>{c.capabilities.map(item=><li key={item}>{item}</li>)}</ul></section>
      <section className="card access-card restricted-access"><span className="eyebrow">PROTECTED BY DESIGN</span><h2>Data outside your workspace</h2><ul>{c.restrictions.map(item=><li key={item}>{item}</li>)}</ul></section>
    </div>
  </div>;
}
