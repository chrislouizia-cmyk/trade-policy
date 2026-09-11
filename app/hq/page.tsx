import AdminDashboard from '@/components/admin/AdminDashboard';
import WorkspaceDashboard from '@/components/hq/WorkspaceDashboard';
import { getHQContext, HQShell } from '@/lib/hq-page';

export default async function HQHome(){
  const {supabase,role,displayName,permissions}=await getHQContext('hq.view');
  if(role==='OWNER'){
    const [{data:overview,error:overviewError},{data:customers,error:customerError},{data:incidents,error:incidentError}]=await Promise.all([
      supabase.rpc('admin_overview'),supabase.rpc('staff_customer_directory_v2',{p_query:'',p_page:1,p_page_size:5,p_sort:'last_activity',p_direction:'desc'}),supabase.rpc('admin_recent_incidents',{p_limit:16}),
    ]);
    if(overviewError)console.error('[HQ_OVERVIEW_FAILED]',overviewError.message);
    if(customerError)console.error('[HQ_CUSTOMER_SUMMARY_FAILED]',customerError.message);
    if(incidentError)console.error('[HQ_INCIDENTS_FAILED]',incidentError.message);

    return <HQShell displayName={displayName} role={role} permissions={permissions}>
      <AdminDashboard
        overview={overviewError?{}:(overview??{})}
        customers={customerError?[]:(customers?.rows??[])}
        incidents={incidentError?[]:(incidents??[])}
        permissions={permissions}
      />
    </HQShell>;
  }
  const {data:overview}=await supabase.rpc('staff_workspace_overview');
  return <HQShell displayName={displayName} role={role} permissions={permissions}><WorkspaceDashboard overview={overview??{}} role={role}/></HQShell>;
}
