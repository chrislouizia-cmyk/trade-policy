import Link from "next/link";
import SystemHealth from "@/components/hq/SystemHealth";

type Overview = Record<string, unknown>;
type Customer = {
  customer_id: string;
  email: string | null;
  display_name: string | null;
  plan: string | null;
  subscription_status: string | null;
  created_at: string;
  strategy_count: number;
  active_strategy: string | null;
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
  resolved_at?: string | null;
};
type Metric = { label: string; value: unknown; sub: string };

function display(value: unknown) {
  return typeof value === "number" ? String(value) : "—";
}
function MetricCard({ metric }: { metric: Metric }) {
  const available = typeof metric.value === "number";
  return (
    <div className="card metric hq-executive-metric">
      <span>{metric.label}</span>
      <strong>{display(metric.value)}</strong>
      <small>{available ? metric.sub : "Not available yet"}</small>
    </div>
  );
}
function IncidentRows({ rows, empty }: { rows: Incident[]; empty: string }) {
  return rows.length === 0 ? (
    <div className="empty-state compact">
      <strong>{empty}</strong>
      <span>Sanitized operational incidents will appear here.</span>
    </div>
  ) : (
    <>
      {rows.map((incident) => (
        <div className="event-row" key={incident.id}>
          <div>
            <strong>{incident.public_code}</strong>
            <small>
              {incident.endpoint || "Internal"} ·{" "}
              {incident.provider || "Internal"}
            </small>
          </div>
          <div>
            <span className={`status-pill ${incident.severity.toLowerCase()}`}>
              {incident.resolved_at ? "Resolved" : incident.severity}
            </span>
            <small>{new Date(incident.created_at).toLocaleString()}</small>
            {incident.resolved_at && (
              <small>
                Resolved {new Date(incident.resolved_at).toLocaleString()}
              </small>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

export default function AdminDashboard({
  overview,
  customers,
  incidents,
  permissions,
}: {
  overview: Overview;
  customers: Customer[];
  incidents: Incident[];
  permissions: string[];
}) {
  const can = (permission: string) => permissions.includes(permission);
  const primary: Metric[] = [
    {
      label: "Active customers",
      value: overview.active_customers_7d,
      sub: "Activity in the last 7 days",
    },
    {
      label: "Analyses today",
      value: overview.analyses_today,
      sub: "Market analysis events today",
    },
    {
      label: "Open trades",
      value: overview.open_trades,
      sub: "Across customer accounts",
    },
    {
      label: "Strategies",
      value: overview.strategies,
      sub: "Active, non-archived profiles",
    },
  ];
  const secondary: Metric[] = [
    {
      label: "Authorizations today",
      value: undefined,
      sub: "Not available yet",
    },
    {
      label: "Trades blocked today",
      value: undefined,
      sub: "Not available yet",
    },
    {
      label: "Open feedback",
      value: overview.open_feedback,
      sub: "Open or under review",
    },
    {
      label: "Open incidents",
      value: overview.open_incidents,
      sub: "Unresolved system incidents",
    },
  ];
  const actions = [
    can("customers.view_metadata") && [
      "View all customers",
      "Search the full customer directory",
      "/hq/customers",
    ],
    can("sales.view") && [
      "Open CRM",
      "Review leads and customer opportunities",
      "/hq/sales",
    ],
    can("support.view") && [
      "Open support",
      "Review customer support work",
      "/hq/support",
    ],
    can("compliance.view") && [
      "Compliance queue",
      "Review permitted compliance cases",
      "/hq/compliance",
    ],
  ].filter(Boolean) as string[][];
  const modules = [
    {
      name: "Customers",
      route: "/hq/customers",
      permission: "customers.view_metadata",
      metrics: [
        ["Active customers", overview.active_customers_7d],
        ["New customers", overview.new_customers_30d],
      ],
    },
    {
      name: "Trading Intelligence",
      route: "/hq/system",
      permission: "system.health",
      metrics: [
        ["Analyses today", overview.analyses_today],
        ["Authorizations today", undefined],
      ],
    },
    {
      name: "Trade Monitoring",
      route: "/hq/system",
      permission: "system.health",
      metrics: [
        ["Open trades", overview.open_trades],
        ["Re-analyses today", undefined],
      ],
    },
    {
      name: "Compliance",
      route: "/hq/compliance",
      permission: "compliance.view",
      metrics: [
        ["Open cases", overview.open_cases],
        ["High priority", overview.high_priority],
      ],
    },
    {
      name: "Support",
      route: "/hq/support",
      permission: "support.view",
      metrics: [
        ["Open tickets", overview.open_tickets],
        ["Open feedback", overview.open_feedback],
      ],
    },
    {
      name: "System",
      route: "/hq/system",
      permission: "system.health",
      metrics: [
        ["Open incidents", overview.open_incidents],
        ["Health status", undefined],
      ],
    },
  ].filter((module) => can(module.permission));
  const openIncidents = incidents.filter((incident) => !incident.resolved_at);

  return (
    <div className="stack admin-shell executive-dashboard">
      {can("system.health") && <SystemHealth />}
      <section className="hq-executive-section">
        <div className="hq-section-heading">
          <div>
            <span className="eyebrow">COMPANY PERFORMANCE</span>
            <h1>Executive overview</h1>
          </div>
          <small>Private operational metadata only</small>
        </div>
        <h2>Primary business KPIs</h2>
        <div className="hq-kpi-grid">
          {primary.map((metric) => (
            <MetricCard key={metric.label} metric={metric} />
          ))}
        </div>
        <h2>Operating KPIs</h2>
        <div className="hq-kpi-grid secondary">
          {secondary.map((metric) => (
            <MetricCard key={metric.label} metric={metric} />
          ))}
        </div>
      </section>

      {actions.length > 0 && (
        <section className="card hq-executive-card">
          <div className="hq-section-heading">
            <div>
              <span className="eyebrow">ACTION CENTER</span>
              <h2>Quick actions</h2>
            </div>
          </div>
          <div className="hq-quick-actions">
            {actions.map(([label, subtitle, route]) => (
              <Link href={route} key={route}>
                <span aria-hidden="true">→</span>
                <strong>{label}</strong>
                <small>{subtitle}</small>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="card hq-executive-card">
        <div className="hq-section-heading">
          <div>
            <span className="eyebrow">RECENT ACTIVITY</span>
            <h2>System incident activity</h2>
          </div>
          <small>Current audit source: system_incidents</small>
        </div>
        <IncidentRows
          rows={incidents.slice(0, 8)}
          empty="No incident activity recorded"
        />
      </section>

      {can("customers.view_metadata") && (
        <section className="card hq-executive-card customer-control">
          <div className="hq-section-heading">
            <div>
              <span className="eyebrow">CUSTOMERS</span>
              <h2>Customer control</h2>
            </div>
            <div className="hq-customer-summary-actions">
              <form action="/hq/customers">
                <input name="q" aria-label="Search all customers" placeholder="Search customers" />
                <button type="submit">Search</button>
              </form>
              <Link className="button-link secondary" href="/hq/customers">View all customers</Link>
            </div>
          </div>
          {customers.length === 0 ? (
            <div className="empty-state compact">
              <strong>No customers found</strong>
              <span>Customer records will appear after signup.</span>
            </div>
          ) : (
            <div className="hq-customer-table">
              <div className="hq-customer-row hq-customer-head">
                <span>Customer</span>
                <span>Plan</span>
                <span>Active strategy</span>
                <span>Accounts</span>
                <span>Analyses</span>
                <span>Last activity</span>
                <span>Status</span>
                <span>Open</span>
              </div>
              {customers.map((customer) => (
                <div className="hq-customer-row" key={customer.customer_id}>
                  <span data-label="Customer">
                    <strong>
                      {customer.display_name || "Unnamed customer"}
                    </strong>
                    <small>{customer.email || "No email"}</small>
                  </span>
                  <span data-label="Plan">
                    {customer.plan || "Not assigned"}
                  </span>
                  <span data-label="Active strategy">
                    <strong>{customer.active_strategy || "—"}</strong>
                    {!customer.active_strategy && <small>Not available yet</small>}
                  </span>
                  <span data-label="Accounts">{customer.account_count}</span>
                  <span data-label="Analyses">{customer.analysis_count}</span>
                  <span data-label="Last activity">
                    {customer.last_activity_at
                      ? new Date(customer.last_activity_at).toLocaleString()
                      : "No recorded activity"}
                  </span>
                  <span data-label="Status">
                    <span className="status-pill">
                      {customer.subscription_status || "Unknown"}
                    </span>
                  </span>
                  <span data-label="Open">
                    <Link href={`/hq/customers/${customer.customer_id}`}>
                      Open
                    </Link>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="card hq-executive-card">
        <div className="hq-section-heading">
          <div>
            <span className="eyebrow">COMPANY OPERATIONS</span>
            <h2>Company Operations</h2>
          </div>
        </div>
        <div className="hq-module-grid">
          {modules.map((module) => (
            <article key={module.name}>
              <div>
                <strong>{module.name}</strong>
                <span className="status-pill">Available</span>
              </div>
              {module.metrics.map(([label, value]) => (
                <p key={String(label)}>
                  <span>{String(label)}</span>
                  <strong>{display(value)}</strong>
                  <small>
                    {typeof value === "number" ? "" : "Not available yet"}
                  </small>
                </p>
              ))}
              <Link href={module.route}>Open {module.name}</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="card hq-executive-card">
        <div className="hq-section-heading">
          <div>
            <span className="eyebrow">INCIDENTS</span>
            <h2>Open system incidents</h2>
          </div>
        </div>
        <IncidentRows rows={openIncidents} empty="No open incidents" />
      </section>
    </div>
  );
}
