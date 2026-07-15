import Link from 'next/link';
import { getHQContext, HQShell } from '@/lib/hq-page';

export default async function Page() {
  const { supabase, role, displayName, permissions } = await getHQContext('customers.view_metadata');
  const { data: customers, error } = await supabase.rpc('staff_customer_directory', { p_limit: 100 });
  if (error) throw new Error(`Customer directory failed: ${error.message}`);
  const rows = customers ?? [];
  return <HQShell displayName={displayName} role={role} permissions={permissions}>
    <section className="card">
      <div className="section-title"><div><span className="eyebrow">CUSTOMERS</span><h1>Customer directory</h1><p className="muted">Open a customer to understand their plan, activity, contact information and current needs.</p></div></div>
      {rows.length === 0 ? <div className="empty-state"><strong>No customer profiles were returned.</strong><span>Employees invited through HQ are intentionally excluded because they do not receive customer profiles. Existing customer profiles will appear here.</span></div> :
      <div className="data-table"><div className="data-row data-head"><span>Customer</span><span>Plan</span><span>Usage</span><span>Last activity</span><span>Action</span></div>{rows.map((c: any) => <div className="data-row" key={c.customer_id}><span><strong>{c.display_name || 'Unnamed customer'}</strong><small>{c.email || 'No email'}</small></span><span><span className="status-pill">{c.plan}</span><small>{c.subscription_status}</small></span><span>{c.strategy_count} strategies · {c.account_count} accounts<small>{c.analysis_count} analyses</small></span><span>{c.last_activity_at ? new Date(c.last_activity_at).toLocaleString() : 'No recorded activity'}</span><span><Link className="button-link secondary" href={`/hq/customers/${c.customer_id}`}>Open profile</Link></span></div>)}</div>}
    </section>
  </HQShell>;
}
