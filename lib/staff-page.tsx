import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import AppHeader from '@/components/AppHeader';
import WorkspaceDashboard from '@/components/hq/WorkspaceDashboard';
export async function StaffPage({allowedRoles,eyebrow}:{allowedRoles:string[];eyebrow:string}){const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect('/login');const {data:role}=await supabase.rpc('current_staff_role');if(!role||(!allowedRoles.includes(role)&&role!=='OWNER'))redirect('/');const displayName=await getUserDisplayName(supabase,user);const {data:overview}=await supabase.rpc('staff_workspace_overview');return <main className="container admin-container"><AppHeader eyebrow={eyebrow} displayName={displayName} description="Role-specific operational workspace." userId={user.id}/><WorkspaceDashboard overview={overview??{}} role={role}/></main>}
