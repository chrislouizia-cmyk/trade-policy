import Link from "next/link";
type Params = {
  q: string;
  page: number;
  pageSize: number;
  sort: string;
  direction: string;
};
function href(params: Params, changes: Partial<Params>) {
  const next = { ...params, ...changes };
  return `/hq/customers?${new URLSearchParams({ q: next.q, page: String(next.page), pageSize: String(next.pageSize), sort: next.sort, direction: next.direction })}`;
}
function readable(value: unknown, fallback = "Not configured") {
  const text = String(value ?? "").trim();
  return text
    ? text
        .toLowerCase()
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : fallback;
}
function CustomerIdentity({ customer }: { customer: any }) {
  const name = customer.display_name || "Unnamed customer";
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part: string) => part[0])
    .join("")
    .toUpperCase();
  return (
    <div className="directory-customer-identity">
      <span aria-hidden="true">{initials || "?"}</span>
      <div>
        <strong>{name}</strong>
        <small>{customer.email || "No email"}</small>
      </div>
    </div>
  );
}
export default function CustomerDirectory({
  rows,
  total,
  summary,
  params,
}: {
  rows: any[];
  total: number;
  summary: Record<string, number>;
  params: Params;
}) {
  const pages = Math.max(1, Math.ceil(total / params.pageSize));
  const first = total ? (params.page - 1) * params.pageSize + 1 : 0,
    last = Math.min(params.page * params.pageSize, total);
  const stats = [
    ["Total customers", summary.total ?? total],
    ["Active", summary.active ?? 0],
    ["Inactive", summary.inactive ?? 0],
    ["Private Beta", summary.privateBeta ?? 0],
    ["Free", summary.free ?? 0],
  ];
  return (
    <div className="customer-directory-widget">
      <div className="directory-summary" aria-label="Filtered customer summary">
        {stats.map(([label, value]) => (
          <div key={String(label)}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <form className="directory-toolbar-v2" method="get">
        <label className="directory-search">
          <span>Search customers</span>
          <input
            name="q"
            defaultValue={params.q}
            placeholder="Search name, email, plan, strategy or account"
          />
        </label>
        <div className="directory-filter-row">
          <label>
            <span>Sort</span>
            <select name="sort" defaultValue={params.sort}>
              <option value="last_activity">Last activity</option>
              <option value="name">Name</option>
              <option value="plan">Plan</option>
              <option value="account_count">Accounts</option>
              <option value="analysis_count">Analyses</option>
              <option value="status">Status</option>
            </select>
          </label>
          <label>
            <span>Direction</span>
            <select name="direction" defaultValue={params.direction}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
          <label>
            <span>Page size</span>
            <select name="pageSize" defaultValue={params.pageSize}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <input type="hidden" name="page" value="1" />
          <button type="submit">Apply</button>
          {params.q && <Link href="/hq/customers">Clear search</Link>}
        </div>
      </form>
      {rows.length > 0 && (
        <>
          <div className="directory-desktop-table">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Plan</th>
                  <th>Active strategy</th>
                  <th>Accounts</th>
                  <th>Analyses</th>
                  <th>Last activity</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((customer) => (
                  <tr key={customer.customer_id}>
                    <td>
                      <CustomerIdentity customer={customer} />
                    </td>
                    <td>
                      <span className="status-pill">
                        {readable(customer.plan, "Not assigned")}
                      </span>
                    </td>
                    <td>{readable(customer.active_strategy)}</td>
                    <td>{customer.account_count}</td>
                    <td>{customer.analysis_count}</td>
                    <td>
                      {customer.last_activity_at
                        ? new Date(customer.last_activity_at).toLocaleString()
                        : "No recorded activity"}
                    </td>
                    <td>
                      <span className="status-pill">
                        {readable(customer.subscription_status, "Unknown")}
                      </span>
                    </td>
                    <td>
                      <Link href={`/hq/customers/${customer.customer_id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="directory-mobile-list">
            {rows.map((customer) => (
              <article
                className="directory-mobile-card"
                key={customer.customer_id}
              >
                <div className="directory-mobile-head">
                  <CustomerIdentity customer={customer} />
                  <span className="status-pill">
                    {readable(customer.subscription_status, "Unknown")}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Plan</dt>
                    <dd>{readable(customer.plan, "Not assigned")}</dd>
                  </div>
                  <div>
                    <dt>Active strategy</dt>
                    <dd>{readable(customer.active_strategy)}</dd>
                  </div>
                  <div>
                    <dt>Trading accounts</dt>
                    <dd>{customer.account_count}</dd>
                  </div>
                  <div>
                    <dt>Analyses</dt>
                    <dd>{customer.analysis_count}</dd>
                  </div>
                  <div className="wide">
                    <dt>Last activity</dt>
                    <dd>
                      {customer.last_activity_at
                        ? new Date(customer.last_activity_at).toLocaleString()
                        : "No recorded activity"}
                    </dd>
                  </div>
                </dl>
                <Link
                  className="directory-profile-link"
                  href={`/hq/customers/${customer.customer_id}`}
                >
                  View profile →
                </Link>
              </article>
            ))}
          </div>
        </>
      )}
      <nav
        className="directory-pagination"
        aria-label="Customer directory pagination"
      >
        <span>
          Showing {first}–{last} of {total}
        </span>
        <div>
          <Link
            className={params.page <= 1 ? "disabled" : ""}
            aria-disabled={params.page <= 1}
            href={
              params.page <= 1 ? "#" : href(params, { page: params.page - 1 })
            }
          >
            Previous
          </Link>
          <strong>
            Page {params.page} of {pages}
          </strong>
          <Link
            className={params.page >= pages ? "disabled" : ""}
            aria-disabled={params.page >= pages}
            href={
              params.page >= pages
                ? "#"
                : href(params, { page: params.page + 1 })
            }
          >
            Next
          </Link>
        </div>
      </nav>
    </div>
  );
}
