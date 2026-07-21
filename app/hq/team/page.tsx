import TeamWorkspace from '@/components/hq/TeamWorkspace';
import { getHQContext, HQShell } from '@/lib/hq-page';

export default async function Page(){
  const {supabase,role,displayName,permissions}=await getHQContext('staff.view');
  const rpc='staff_team_workspace_v3';
  const args={p_query:'',p_page:1,p_page_size:25,p_department_id:'ALL',p_position_id:'ALL',p_manager_id:'ALL',p_status:'ALL'};
  const {data,error}=await supabase.rpc(rpc,args);
  if(error)console.error('[Team workspace RPC failure]',{rpc,args,error:{code:error.code,message:error.message,details:error.details,hint:error.hint}});
  return <HQShell displayName={displayName} role={role} permissions={permissions}><TeamWorkspace initialData={data} initialError={error?'Team workspace data could not be loaded.':null} canManage={permissions.includes('staff.manage')}/></HQShell>;
}
