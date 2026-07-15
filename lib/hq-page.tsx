import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import HQPageShell from '@/components/hq/HQPageShell';
export async function getHQContext(permission='hq.view'){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)redirect('/hq/login');
  const [{data:role},{data:allowed},{data:permissionRows}]=await Promise.all([
    supabase.rpc('current_staff_role'),supabase.rpc('has_staff_permission',{p_permission:permission}),supabase.rpc('current_staff_permissions'),
  ]);
  if(!role||!allowed)redirect('/hq/login?error=access');
  const displayName=await getUserDisplayName(supabase,user);
  const permissions=(permissionRows??[]).map((row:any)=>String(row.permission_key));
  return {supabase,user,role:String(role),displayName,permissions};
}
export function HQShell({displayName,role,permissions,children}:{displayName:string;role:string;permissions:string[];children:React.ReactNode}){
  return <HQPageShell displayName={displayName} role={role} permissions={permissions}>{children}</HQPageShell>;
}
