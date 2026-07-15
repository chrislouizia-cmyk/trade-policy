import SalesWorkspace from '@/components/hq/SalesWorkspace';
import { getHQContext, HQShell } from '@/lib/hq-page';

export default async function Page() {
  const { supabase, role, displayName, permissions } = await getHQContext('sales.view');
  const { data, error } = await supabase.rpc('staff_sales_operational_queue', { p_limit: 250 });
  if (error) throw new Error(`Sales queue failed: ${error.message}`);
  const items = Array.isArray(data) ? data : [];
  return <HQShell displayName={displayName} role={role} permissions={permissions}>
    <SalesWorkspace items={items} />
  </HQShell>;
}
