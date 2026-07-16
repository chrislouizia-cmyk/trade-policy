import { notFound } from "next/navigation";
import { getHQContext, HQShell } from "@/lib/hq-page";
import Link from "next/link";

function Empty({ children = "Not available yet" }: { children?: string }) {
  return <p className="muted customer-overview-empty">{children}</p>;
}
function List({
  rows,
  render,
  empty,
}: {
  rows: any[];
  render: (row: any) => React.ReactNode;
  empty: string;
}) {
  return rows.length ? (
    <div className="customer-overview-list">
      {rows.map((row, index) => (
        <div key={row.id ?? `${index}`}>{render(row)}</div>
      ))}
    </div>
  ) : (
    <Empty>{empty}</Empty>
  );
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, role, displayName, permissions } = await getHQContext(
    "customers.view_metadata",
  );
  const [{ data, error }, { data: operations, error: operationsError }] =
    await Promise.all([
      supabase.rpc("staff_customer_360", { p_customer_id: id }),
      supabase.rpc("staff_customer_operational_detail", { p_customer_id: id }),
    ]);
  if (error) throw new Error("Customer profile could not be loaded.");
  if (operationsError)
    throw new Error("Customer operations could not be loaded.");
  if (!data) notFound();
  const customer: any = { ...data, ...operations };
  const salesDraftResult = permissions.includes("sales.view")
    ? await supabase.rpc("staff_sales_email_drafts_v2", {
          p_query: "",
          p_page: 1,
          p_page_size: 25,
          p_status: "ALL",
          p_template: "ALL",
          p_language: "ALL",
          p_customer_id: id,
        })
    : null;
  if (salesDraftResult?.error)
    throw new Error("Customer Sales drafts could not be loaded.");
  const salesDrafts = salesDraftResult ? salesDraftResult.data?.rows ?? [] : null;
  const accounts = customer.accounts ?? [],
    strategies = customer.strategies ?? [],
    analyses = customer.analyses ?? [],
    trades = customer.trades ?? [],
    feedback = customer.feedback,
    timeline = customer.timeline ?? [];
  return (
    <HQShell displayName={displayName} role={role} permissions={permissions}>
      <main className="customer-overview-page">
        <header className="customer-overview-header">
          <div>
            <span className="eyebrow">CUSTOMER OVERVIEW</span>
            <h1>{customer.display_name || "Unnamed customer"}</h1>
            <p>{customer.email || "No email provided"}</p>
          </div>
          <a
            className="button-link secondary"
            href={`/api/hq/customers/${id}/report`}
          >
            Download Customer Report
          </a>
          {permissions.includes("sales.manage") && (
            <Link className="button-link primary" href={`/hq/sales/drafts/new?customer=${id}`}>
              Draft email
            </Link>
          )}
        </header>
        <section
          className="customer-overview-summary"
          aria-label="Customer summary"
        >
          {[
            ["Trading accounts", accounts.length],
            ["Strategies", strategies.length],
            ["Analyses", customer.analysis_count ?? 0],
            ["Open trades", customer.open_trades ?? 0],
            ["Closed trades", customer.closed_trades ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>
        <section className="customer-overview-section">
          <h2>Profile</h2>
          <dl className="customer-profile-grid">
            <div>
              <dt>Plan</dt>
              <dd>{customer.plan || "Not available yet"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{customer.subscription_status || "Not available yet"}</dd>
            </div>
            <div>
              <dt>Member since</dt>
              <dd>
                {customer.created_at
                  ? new Date(customer.created_at).toLocaleDateString()
                  : "Not available yet"}
              </dd>
            </div>
            <div>
              <dt>Last activity</dt>
              <dd>
                {customer.last_activity_at
                  ? new Date(customer.last_activity_at).toLocaleString()
                  : "No recorded activity"}
              </dd>
            </div>
          </dl>
        </section>
        <section className="customer-overview-section">
          <h2>Trading Accounts</h2>
          <List
            rows={accounts}
            empty="No trading accounts"
            render={(account) => (
              <>
                <strong>{account.name}</strong>
                <small>
                  {[
                    account.broker,
                    account.type,
                    account.currency,
                    account.balance != null
                      ? `${account.balance} ${account.currency || ""}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Account metadata unavailable"}
                  {account.active ? " · Active" : ""}
                  {account.created_at
                    ? ` · Created ${new Date(account.created_at).toLocaleDateString()}`
                    : ""}
                </small>
              </>
            )}
          />
        </section>
        <section className="customer-overview-section">
          <h2>Strategies</h2>
          <List
            rows={strategies}
            empty="No strategies"
            render={(strategy) => (
              <>
                <strong>{strategy.name}</strong>
                <small>
                  {strategy.active
                    ? "Active strategy"
                    : strategy.created_at
                      ? `Created ${new Date(strategy.created_at).toLocaleDateString()}`
                      : "Inactive"}
                </small>
                <small>
                  {[
                    strategy.trading_style,
                    strategy.maximum_risk_percent != null
                      ? `${strategy.maximum_risk_percent}% risk`
                      : null,
                    strategy.minimum_rr != null
                      ? `Minimum RR 1:${strategy.minimum_rr}`
                      : null,
                    strategy.confidence_threshold != null
                      ? `${strategy.confidence_threshold}% confidence`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </>
            )}
          />
        </section>
        <section className="customer-overview-section">
          <h2>Recent Analyses</h2>
          <List
            rows={analyses}
            empty="No analyses yet"
            render={(analysis) => (
              <>
                <strong>
                  {analysis.instrument || "Market analysis"}
                  {analysis.direction ? ` · ${analysis.direction}` : ""}
                </strong>
                <small>
                  {[
                    analysis.confidence
                      ? `${analysis.confidence}% confidence`
                      : null,
                    analysis.outcome,
                    analysis.created_at
                      ? new Date(analysis.created_at).toLocaleString()
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </>
            )}
          />
        </section>
        <section className="customer-overview-section">
          <h2>Trade History</h2>
          <List
            rows={trades}
            empty="No trades yet"
            render={(trade) => (
              <>
                <strong>
                  {trade.instrument} · {trade.direction} · {trade.status}
                </strong>
                <small>
                  Entry {trade.entry ?? "—"} · SL {trade.stop_loss ?? "—"} · TP{" "}
                  {trade.take_profit ?? "—"}
                  {trade.outcome ? ` · ${trade.outcome}` : ""}
                  {trade.result_r != null ? ` · ${trade.result_r}R` : ""}
                  {trade.opened_at
                    ? ` · ${new Date(trade.opened_at).toLocaleString()}`
                    : ""}
                  {trade.closed_at
                    ? ` · Closed ${new Date(trade.closed_at).toLocaleString()}`
                    : ""}
                </small>
              </>
            )}
          />
        </section>
        <section className="customer-overview-section">
          <h2>Feedback</h2>
          {feedback === null ? (
            <Empty>You do not have permission to view customer feedback.</Empty>
          ) : (
            <List
              rows={feedback ?? []}
              empty="No feedback records"
              render={(item) => (
                <>
                  <strong>
                    {item.type} · {item.status}
                  </strong>
                  <small>
                    {item.message}
                    {item.created_at
                      ? ` · ${new Date(item.created_at).toLocaleString()}`
                      : ""}
                  </small>
                </>
              )}
            />
          )}
        </section>
        <section className="customer-overview-section">
          <div className="section-title">
            <h2>Sales Drafts</h2>
            {salesDrafts !== null && (
              <Link href={`/hq/sales/drafts?q=${encodeURIComponent(customer.email || "")}`}>
                Open Sales drafts
              </Link>
            )}
          </div>
          {salesDrafts === null ? (
            <Empty>You do not have permission to view Sales drafts.</Empty>
          ) : (
            <List
              rows={salesDrafts}
              empty="No Sales drafts for this customer."
              render={(draft) => (
                <>
                  <strong>{draft.subject || "Untitled draft"}</strong>
                  <small>
                    {draft.template_type} · {draft.status} · {draft.language}
                    {draft.generated_by_ai ? " · AI-generated" : ""}
                    {draft.created_by ? ` · Author ${draft.created_by}` : ""}
                    {draft.updated_at
                      ? ` · Updated ${new Date(draft.updated_at).toLocaleString()}`
                      : ""}
                  </small>
                  {permissions.includes("sales.manage") && (
                    <Link href={`/hq/sales/drafts/${draft.id}`}>Resume draft</Link>
                  )}
                </>
              )}
            />
          )}
        </section>
        <section className="customer-overview-section">
          <h2>Activity Timeline</h2>
          <List
            rows={timeline}
            empty="No customer activity recorded"
            render={(item) => (
              <>
                <strong>{item.title || item.type}</strong>
                <small>
                  {item.detail || "No detail"}
                  {item.created_at
                    ? ` · ${new Date(item.created_at).toLocaleString()}`
                    : ""}
                </small>
              </>
            )}
          />
        </section>
        <section className="customer-overview-section">
          <h2>Notes</h2>
          <List
            rows={timeline.filter((item: any) => item.type === "NOTE")}
            empty="Not available yet"
            render={(item) => (
              <>
                <strong>{item.title || "Internal note"}</strong>
                <small>
                  {item.detail}
                  {item.created_at
                    ? ` · ${new Date(item.created_at).toLocaleString()}`
                    : ""}
                </small>
              </>
            )}
          />
        </section>
        <section className="customer-overview-section">
          <h2>Internal Flags</h2>
          <Empty>
            No permitted internal flags are available under the current data
            contract.
          </Empty>
        </section>
      </main>
    </HQShell>
  );
}
