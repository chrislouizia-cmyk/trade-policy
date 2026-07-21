import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const InviteSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(2).max(120),
  departmentId:z.string().uuid(),positionId:z.string().uuid(),permissionProfileId:z.string().uuid(),reportsToEmployeeId:z.string().uuid().or(z.literal('')).optional().default(''),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

    const [{ data: role }, { data: allowed }] = await Promise.all([
      supabase.rpc('current_staff_role'),
      supabase.rpc('has_staff_permission', { p_permission: 'staff.manage' }),
    ]);
    if (role !== 'OWNER' || !allowed) {
      return NextResponse.json({ error: 'Only the Owner can invite staff.' }, { status: 403 });
    }

    const parsed = InviteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid invitation.' }, { status: 400 });
    }

    const { email, displayName, departmentId, positionId, permissionProfileId, reportsToEmployeeId } = parsed.data;
    const admin = createAdminClient();
    const { data: organizationId, error: orgError } = await supabase.rpc('ensure_internal_organization');
    if (orgError) return NextResponse.json({ error: orgError.message }, { status: 400 });
    const [{data:department},{data:position},{data:permissionProfile},{data:manager}]=await Promise.all([
      admin.from('org_departments').select('id,name').eq('id',departmentId).eq('organization_id',organizationId).eq('active',true).maybeSingle(),
      admin.from('org_positions').select('id,title,department_id').eq('id',positionId).eq('organization_id',organizationId).eq('active',true).maybeSingle(),
      admin.from('permission_profiles').select('id,name,role_key').eq('id',permissionProfileId).eq('organization_id',organizationId).eq('active',true).maybeSingle(),
      reportsToEmployeeId?admin.from('staff_roles').select('user_id').eq('user_id',reportsToEmployeeId).eq('organization_id',organizationId).eq('is_active',true).maybeSingle():Promise.resolve({data:null}),
    ]);
    if(!department)return NextResponse.json({error:'Active department required.'},{status:400});
    if(!position||position.department_id!==department.id)return NextResponse.json({error:'Position must belong to the selected department.'},{status:400});
    if(!permissionProfile)return NextResponse.json({error:'Active permission profile required.'},{status:400});
    if(permissionProfile.role_key==='OWNER')return NextResponse.json({error:'The Owner permission profile cannot be assigned by invitation.'},{status:400});
    if(reportsToEmployeeId&&!manager)return NextResponse.json({error:'Reports To must reference an active employee.'},{status:400});
    const staffRole=permissionProfile.role_key,title=position.title;
    const origin = new URL(request.url).origin;
    const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/hq`,
      data: { account_type: 'staff', display_name: displayName },
    });
    if (inviteError || !invite.user) {
      const message = inviteError?.message ?? 'Invitation could not be created.';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { error: staffError } = await admin.from('staff_roles').upsert({
      user_id: invite.user.id,
      role: staffRole,
      is_active: true,
      organization_id: organizationId,
      display_title: title || staffRole.replaceAll('_', ' '),
      invited_by: user.id,
      mfa_required: true,
      department: department.name,department_id:department.id,position_id:position.id,permission_profile_id:permissionProfile.id,
      manager_user_id: reportsToEmployeeId || null,reports_to_employee_id:reportsToEmployeeId||null,
    }, { onConflict: 'user_id' });
    if (staffError) return NextResponse.json({ error: staffError.message }, { status: 400 });

    const { error: memberError } = await admin.from('organization_members').upsert({
      organization_id: organizationId,
      user_id: invite.user.id,
      membership_type: 'STAFF',
      status: 'INVITED',
    }, { onConflict: 'organization_id,user_id' });
    if (memberError) return NextResponse.json({ error: memberError.message }, { status: 400 });

    await admin.from('staff_invitations').upsert({
      user_id: invite.user.id,
      email,
      display_name: displayName,
      role: staffRole,
      display_title: title || null,
      organization_id: organizationId,
      invited_by: user.id,
      status: 'INVITED',
      invited_at: new Date().toISOString(),
      expires_at: new Date(Date.now()+7*24*60*60*1000).toISOString(),
      department: department.name,
      manager_user_id: reportsToEmployeeId || null,
    }, { onConflict: 'email' });

    await admin.from('admin_access_logs').insert({staff_user_id:user.id,customer_user_id:invite.user.id,action:'INVITE_STAFF',resource_type:'STAFF_INVITATION',resource_id:invite.user.id,access_scope:staffRole,success:true,metadata:{email}});

    return NextResponse.json({ ok: true, message: `Invitation sent to ${email}.` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected invitation error.' }, { status: 500 });
  }
}

const ActionSchema=z.object({invitationId:z.string().uuid(),action:z.enum(['resend','cancel'])});
export async function PATCH(request:Request){
 try{
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:'Authentication required.'},{status:401});
  const {data:allowed}=await supabase.rpc('has_staff_permission',{p_permission:'staff.manage'});if(!allowed)return NextResponse.json({error:'Staff management permission denied.'},{status:403});
  const parsed=ActionSchema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:'Invalid invitation action.'},{status:400});
  const admin=createAdminClient();const {data:invitation,error}=await admin.from('staff_invitations').select('id,user_id,email,display_name,status').eq('id',parsed.data.invitationId).single();if(error||!invitation)return NextResponse.json({error:'Invitation not found.'},{status:404});
  if(parsed.data.action==='cancel'){
   const {error:updateError}=await admin.from('staff_invitations').update({status:'CANCELLED',updated_at:new Date().toISOString()}).eq('id',invitation.id);if(updateError)return NextResponse.json({error:updateError.message},{status:400});
   await admin.from('staff_roles').update({is_active:false,updated_at:new Date().toISOString()}).eq('user_id',invitation.user_id);
   await admin.from('organization_members').update({status:'REMOVED'}).eq('user_id',invitation.user_id);
   await admin.from('admin_access_logs').insert({staff_user_id:user.id,customer_user_id:invitation.user_id,action:'CANCEL_STAFF_INVITATION',resource_type:'STAFF_INVITATION',resource_id:invitation.id,success:true,metadata:{email:invitation.email}});
   return NextResponse.json({ok:true,message:`Invitation for ${invitation.email} cancelled.`});
  }
  const origin=new URL(request.url).origin;const {error:resendError}=await admin.auth.admin.inviteUserByEmail(invitation.email,{redirectTo:`${origin}/auth/callback?next=/hq`,data:{account_type:'staff',display_name:invitation.display_name}});if(resendError)return NextResponse.json({error:resendError.message},{status:400});
  await admin.from('staff_invitations').update({status:'INVITED',invited_at:new Date().toISOString(),expires_at:new Date(Date.now()+7*24*60*60*1000).toISOString(),updated_at:new Date().toISOString()}).eq('id',invitation.id);
  await admin.from('admin_access_logs').insert({staff_user_id:user.id,customer_user_id:invitation.user_id,action:'RESEND_STAFF_INVITATION',resource_type:'STAFF_INVITATION',resource_id:invitation.id,success:true,metadata:{email:invitation.email}});
  return NextResponse.json({ok:true,message:`Invitation resent to ${invitation.email}.`});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Invitation action failed.'},{status:500})}
}
