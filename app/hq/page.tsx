import AdminDashboard from '@/components/admin/AdminDashboard';
import WorkspaceDashboard from '@/components/hq/WorkspaceDashboard';
import { getHQContext, HQShell } from '@/lib/hq-page';

export default async function HQHome(){
  const {supabase,role,displayName,permissions}=await getHQContext('hq.view');
  if(role==='OWNER'){
    const [{data:commandCenter,error:commandCenterError},{data:customers,error:customerError}]=await Promise.all([
      supabase.rpc('staff_owner_command_center'),
      supabase.rpc('staff_customer_directory_v2',{p_query:'',p_page:1,p_page_size:5,p_sort:'last_activity',p_direction:'desc'}),
    ]);
    if(commandCenterError)console.error('[HQ_COMMAND_CENTER_FAILED]',commandCenterError.message);
    if(customerError)console.error('[HQ_CUSTOMER_SUMMARY_FAILED]',customerError.message);

    return <HQShell displayName={displayName} role={role} permissions={permissions}>
      <AdminDashboard
        commandCenter={commandCenterError?null:(commandCenter??null)}
        customers={customerError?[]:(customers?.rows??[])}
        permissions={permissions}
        loadError={commandCenterError?'Executive data could not be loaded. Retry before relying on these metrics.':null}
      />
    </HQShell>;
  }
  const {data:overview,error}=await supabase.rpc('staff_workspace_overview');
  if(error)console.error('[HQ_WORKSPACE_OVERVIEW_FAILED]',{role,code:error.code,message:error.message});
  return <HQShell displayName={displayName} role={role} permissions={permissions}><WorkspaceDashboard overview={error?{}:(overview??{})} role={role}/></HQShell>;
}
