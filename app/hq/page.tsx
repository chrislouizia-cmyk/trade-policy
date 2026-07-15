import AdminDashboard from '@/components/admin/AdminDashboard';
import WorkspaceDashboard from '@/components/hq/WorkspaceDashboard';
import { getHQContext, HQShell } from '@/lib/hq-page';

export default async function HQHome(){
  const {supabase,role,displayName,permissions}=await getHQContext('hq.view');
  if(role==='OWNER'){
    const [{data:overview},{data:customers},{data:incidents}]=await Promise.all([
      supabase.rpc('admin_overview'),supabase.rpc('admin_customers',{p_limit:100}),supabase.rpc('admin_recent_incidents',{p_limit:50}),
    ]);
    return <HQShell displayName={displayName} role={role} permissions={permissions}><AdminDashboard overview={overview??{}} customers={customers??[]} incidents={incidents??[]}/></HQShell>;
  }
  const {data:overview}=await supabase.rpc('staff_workspace_overview');
  return <HQShell displayName={displayName} role={role} permissions={permissions}><WorkspaceDashboard overview={overview??{}} role={role}/></HQShell>;
}
