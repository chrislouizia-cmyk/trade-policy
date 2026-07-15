import StaffDirectory from '@/components/hq/StaffDirectory';
import { getHQContext, HQShell } from '@/lib/hq-page';
export default async function Page(){const {supabase,role,displayName,permissions}=await getHQContext('staff.view');await supabase.rpc('ensure_internal_organization');const {data}=await supabase.rpc('owner_staff_directory');return <HQShell displayName={displayName} role={role} permissions={permissions}><StaffDirectory initialStaff={data??[]}/></HQShell>}
