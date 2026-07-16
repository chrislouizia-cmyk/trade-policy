import Link from "next/link";
import { getHQContext, HQShell } from "@/lib/hq-page";
import CustomerDirectory from "@/components/hq/CustomerDirectory";
import ExcelExportButton from "@/components/hq/ExcelExportButton";
const sorts = new Set([
  "name",
  "plan",
  "last_activity",
  "account_count",
  "analysis_count",
  "status",
]);
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const q = String(query.q ?? "").slice(0, 120),
    page = Math.max(1, Number(query.page) || 1),
    requestedSize = Number(query.pageSize) || 25;
  const pageSize = [25, 50, 100].includes(requestedSize) ? requestedSize : 25,
    sort = sorts.has(String(query.sort)) ? String(query.sort) : "last_activity",
    direction = query.direction === "asc" ? "asc" : "desc";
  const { supabase, role, displayName, permissions } = await getHQContext(
    "customers.view_metadata",
  );
  const { data, error } = await supabase.rpc("staff_customer_directory_v2", {
    p_query: q,
    p_page: page,
    p_page_size: pageSize,
    p_sort: sort,
    p_direction: direction,
  });
  if (error) throw new Error("Customer directory query failed.");
  const rows = data?.rows ?? [],
    total = Number(data?.total ?? 0),
    summary = data?.summary ?? {},
    exportQuery = new URLSearchParams({ q, sort, direction }).toString();
  return (
    <HQShell displayName={displayName} role={role} permissions={permissions}>
      <main className="customer-directory-page">
        <header className="directory-page-header">
          <div>
            <span className="eyebrow">HQ CUSTOMER CONTROL</span>
            <h1>Customers</h1>
            <p>
              Manage customer access, plans, strategies, accounts, and platform
              activity.
            </p>
            <div className="directory-result-context">
              <strong>
                {total} {total === 1 ? "customer" : "customers"}
              </strong>
              {q && <span>Search: “{q}”</span>}
            </div>
          </div>
          <ExcelExportButton query={exportQuery} />
        </header>
        <section className="directory-results-surface">
          <CustomerDirectory
            rows={rows}
            total={total}
            summary={summary}
            params={{ q, page, pageSize, sort, direction }}
          />
          {rows.length === 0 && (
            <div className="directory-empty-state">
              <strong>
                {q ? "No customers match your filters." : "No customers yet."}
              </strong>
              {q && (
                <Link href="/hq/customers" className="button-link secondary">
                  Clear filters
                </Link>
              )}
            </div>
          )}
        </section>
      </main>
    </HQShell>
  );
}
