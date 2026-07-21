import {NextResponse} from 'next/server';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const InviteSchema=z.object({
 email:z.string({required_error:'Email is required.'}).trim().email('Enter a valid employee email.'),
 displayName:z.string({required_error:'Employee name is required.'}).trim().min(2,'Employee name is required.').max(120),
 departmentId:z.string({required_error:'Department is required.'}).uuid('Department is required.'),
 positionId:z.string({required_error:'Position is required.'}).uuid('Position is required.'),
 permissionProfileId:z.string({required_error:'Permission profile is required.'}).uuid('Permission profile is required.'),
 reportsToEmployeeId:z.string().uuid('Select an eligible manager.').or(z.literal('')).optional().default(''),
});
type AdminClient=ReturnType<typeof createAdminClient>;
type InviteInput=z.infer<typeof InviteSchema>;
type Preflight={invitationId:string;email:string;displayName:string;departmentId:string;department:string;positionId:string;position:string;permissionProfileId:string;permissionProfile:string;roleKey:string;reportsToEmployeeId:string|null};
const jsonError=(error:string,status:number,requestId:string,code:string)=>NextResponse.json({ok:false,error,code,requestId},{status});
function serverLog(level:'info'|'error',event:string,details:Record<string,unknown>){console[level](JSON.stringify({scope:'staff_invitation',event,...details}))}
async function findAuthUserByEmail(admin:AdminClient,email:string){for(let page=1;page<=20;page++){const {data,error}=await admin.auth.admin.listUsers({page,perPage:100});if(error)throw error;const match=data.users.find(user=>user.email?.toLowerCase()===email.toLowerCase());if(match)return match;if(data.users.length<100)return null}return null}
function authFailure(error:unknown){const raw=error instanceof Error?error.message:String(error??'');if(/rate.?limit|too many requests/i.test(raw))return{message:'Email rate limit exceeded. Wait before trying again or check the Supabase Auth email rate limit.',status:429,code:'EMAIL_RATE_LIMIT'};if(/already.*registered|already.*exists/i.test(raw))return{message:'This email already belongs to an employee or existing account.',status:409,code:'EMAIL_EXISTS'};return{message:`Supabase could not create the invitation${raw?`: ${raw}`:'.'}`,status:502,code:'AUTH_INVITE_FAILED'}}
function rpcFailure(message:string){if(/already has a pending invitation/i.test(message))return{message:'This email already has a pending invitation.',status:409,code:'DUPLICATE_PENDING_INVITATION'};if(/already belongs to an employee/i.test(message))return{message:'This email already belongs to an employee.',status:409,code:'DUPLICATE_EMPLOYEE'};if(/permission denied|not authorized/i.test(message))return{message:'You are not authorized to invite employees.',status:403,code:'FORBIDDEN'};return{message:message.replace(/\s*\(.*\)$/,''),status:400,code:'INVITATION_VALIDATION_FAILED'}}
const rpcInput=(input:InviteInput,requestId:string)=>({p_email:input.email,p_display_name:input.displayName,p_department_id:input.departmentId,p_position_id:input.positionId,p_permission_profile_id:input.permissionProfileId,p_reports_to_employee_id:input.reportsToEmployeeId||null,p_request_id:requestId});

export async function POST(request:Request){
 const requestId=crypto.randomUUID();let input:InviteInput|undefined;let preflight:Preflight|undefined;
 try{
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user)return jsonError('Authentication required.',401,requestId,'AUTH_REQUIRED');
  const [{data:role,error:roleError},{data:allowed,error:permissionError}]=await Promise.all([supabase.rpc('current_staff_role'),supabase.rpc('has_staff_permission',{p_permission:'staff.manage'})]);
  if(roleError||permissionError){serverLog('error','authorization_lookup_failed',{requestId,roleError:roleError?.message,permissionError:permissionError?.message});return jsonError('Employee invitation authorization could not be verified.',500,requestId,'AUTHORIZATION_LOOKUP_FAILED')}
  if(!allowed||!['OWNER','SECURITY_ADMIN'].includes(role))return jsonError('You are not authorized to invite employees.',403,requestId,'FORBIDDEN');
  let body:unknown;try{body=await request.json()}catch{return jsonError('Invitation request is not valid JSON.',400,requestId,'INVALID_JSON')}
  const parsed=InviteSchema.safeParse(body);if(!parsed.success)return jsonError(parsed.error.issues[0]?.message??'Invalid invitation.',400,requestId,'VALIDATION_FAILED');
  input=parsed.data;
  const {data:duplicates,error:duplicateError}=await supabase.rpc('check_staff_invitation_duplicate_v1',{p_email:input.email});
  if(duplicateError)throw new Error(`Duplicate invitation check failed: ${duplicateError.message}`);
  const duplicate=duplicates?.[0];
  if(duplicate?.status==='PENDING'&&(!duplicate.expires_at||new Date(duplicate.expires_at)>new Date()))return jsonError('This email already has a pending invitation.',409,requestId,'DUPLICATE_PENDING_INVITATION');
  const {data:prepared,error:prepareError}=await supabase.rpc('prepare_staff_invitation_v1',rpcInput(input,requestId));
  if(prepareError){const failure=rpcFailure(prepareError.message);return jsonError(failure.message,failure.status,requestId,failure.code)}
  preflight=prepared as Preflight;
  const admin=createAdminClient();
  const existingAuth=await findAuthUserByEmail(admin,preflight.email);
  if(existingAuth)return jsonError('This email already belongs to an employee or existing account.',409,requestId,'EMAIL_EXISTS');
  const expiresAt=new Date(Date.now()+7*24*60*60*1000).toISOString();
  const redirectTo=`${new URL(request.url).origin}/auth/callback?next=/hq`;
  const {data:authInvite,error:inviteError}=await admin.auth.admin.inviteUserByEmail(preflight.email,{redirectTo,data:{account_type:'staff',display_name:preflight.displayName}});
  if(inviteError||!authInvite.user){
   const failure=authFailure(inviteError);
   const {error:failureError}=await supabase.rpc('mark_staff_invitation_delivery_failed_v1',{...rpcInput(input,requestId),p_invitation_id:preflight.invitationId,p_auth_user_id:null,p_expires_at:expiresAt,p_delivery_provider:'SUPABASE_AUTH',p_error_category:failure.code,p_error_message:failure.message,p_auth_cleanup_succeeded:null});
   if(failureError)serverLog('error','delivery_failure_persistence_failed',{requestId,error:failureError.message});
   serverLog('error','auth_invitation_failed',{requestId,code:failure.code,error:inviteError?.message});return jsonError(failure.message,failure.status,requestId,failure.code)
  }
  const invitedUser=authInvite.user;
  const {data:invitation,error:persistenceError}=await supabase.rpc('create_staff_invitation_v1',{...rpcInput(input,requestId),p_invitation_id:preflight.invitationId,p_auth_user_id:invitedUser.id,p_expires_at:expiresAt,p_delivery_provider:'SUPABASE_AUTH',p_provider_message_id:null});
  if(persistenceError){
   const cleanup=await admin.auth.admin.deleteUser(invitedUser.id);
   const message=`Invitation created, but employee setup failed. ${persistenceError.message}`;
   const {error:failureError}=await supabase.rpc('mark_staff_invitation_delivery_failed_v1',{...rpcInput(input,requestId),p_invitation_id:preflight.invitationId,p_auth_user_id:cleanup.error?invitedUser.id:null,p_expires_at:expiresAt,p_delivery_provider:'SUPABASE_AUTH',p_error_category:'PERSISTENCE_FAILED',p_error_message:message,p_auth_cleanup_succeeded:!cleanup.error});
   serverLog('error','persistence_failed',{requestId,error:persistenceError.message,authCleanupError:cleanup.error?.message,failurePersistenceError:failureError?.message});
   return jsonError(cleanup.error?'Invitation created, but employee setup failed and Auth cleanup requires attention.':'Invitation created, but employee setup failed. The Auth invitation was cleaned up.',500,requestId,'PERSISTENCE_FAILED')
  }
  serverLog('info','invitation_pending',{requestId,invitationId:preflight.invitationId,userId:invitedUser.id});
  return NextResponse.json({ok:true,requestId,invitation,delivery:{provider:'SUPABASE_AUTH',accepted:true,confirmed:false,message:'Supabase Auth accepted the invitation request. Final email delivery is not confirmed.'},message:`Invitation created for ${preflight.email}. Email delivery was requested but cannot be confirmed.`},{status:201});
 }catch(error){const message=error instanceof Error?error.message:'Unexpected invitation error.';serverLog('error','unexpected_failure',{requestId,error:message});return jsonError(`Employee invitation failed: ${message}`,500,requestId,'UNEXPECTED_FAILURE')}
}

const ActionSchema=z.object({invitationId:z.string().uuid(),action:z.enum(['resend','revoke'])});
export async function PATCH(request:Request){
 const requestId=crypto.randomUUID();
 try{
  const supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();if(!user)return jsonError('Authentication required.',401,requestId,'AUTH_REQUIRED');
  const [{data:role},{data:allowed}]=await Promise.all([supabase.rpc('current_staff_role'),supabase.rpc('has_staff_permission',{p_permission:'staff.manage'})]);
  if(!allowed||!['OWNER','SECURITY_ADMIN'].includes(role))return jsonError('You are not authorized to manage invitations.',403,requestId,'FORBIDDEN');
  const parsed=ActionSchema.safeParse(await request.json());if(!parsed.success)return jsonError('Invalid invitation action.',400,requestId,'INVALID_ACTION');
  const admin=createAdminClient();
  if(parsed.data.action==='revoke'){
   const {data:revoked,error}=await supabase.rpc('revoke_staff_invitation_v1',{p_invitation_id:parsed.data.invitationId,p_request_id:requestId});
   if(error)return jsonError(error.message,400,requestId,'REVOKE_FAILED');
   if(revoked.userId){const cleanup=await admin.auth.admin.deleteUser(revoked.userId);if(cleanup.error){serverLog('error','revoked_auth_cleanup_failed',{requestId,userId:revoked.userId,error:cleanup.error.message});return jsonError('Invitation was revoked, but Auth cleanup requires attention.',500,requestId,'AUTH_CLEANUP_FAILED')}}
   return NextResponse.json({ok:true,message:`Invitation for ${revoked.email} revoked.`,requestId});
  }
  const {data:invitation,error:prepareError}=await supabase.rpc('resend_staff_invitation_prepare_v1',{p_invitation_id:parsed.data.invitationId,p_request_id:requestId});
  if(prepareError)return jsonError(prepareError.message,400,requestId,'RESEND_NOT_ALLOWED');
  const {error:resendError}=await admin.auth.resend({type:'signup',email:invitation.email,options:{emailRedirectTo:`${new URL(request.url).origin}/auth/callback?next=/hq`}});
  if(resendError){const failure=authFailure(resendError);const {error:failureError}=await supabase.rpc('mark_staff_invitation_resend_failed_v1',{p_invitation_id:invitation.id,p_request_id:requestId,p_error_category:failure.code,p_error_message:failure.message});serverLog('error','resend_failed',{requestId,code:failure.code,error:resendError.message,failurePersistenceError:failureError?.message});return jsonError(failure.message,failure.status,requestId,failure.code)}
  const {error:finalizeError}=await supabase.rpc('mark_staff_invitation_resent_v1',{p_invitation_id:invitation.id,p_request_id:requestId,p_expires_at:new Date(Date.now()+7*24*60*60*1000).toISOString()});
  if(finalizeError)return jsonError(`Resend was accepted by Auth, but persistence failed: ${finalizeError.message}`,500,requestId,'RESEND_PERSISTENCE_FAILED');
  return NextResponse.json({ok:true,message:`Invitation delivery requested again for ${invitation.email}; final delivery is not confirmed.`,delivery:{accepted:true,confirmed:false},requestId});
 }catch(error){const message=error instanceof Error?error.message:'Invitation action failed.';serverLog('error','action_failed',{requestId,error:message});return jsonError(message,500,requestId,'ACTION_FAILED')}
}
