import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {getCanonicalAppUrls} from '../lib/app-urls.ts';
import {getHostnameRoutingDecision} from '../lib/hostname-routing.ts';

const route=readFileSync(new URL('../app/api/hq/staff/invite/route.ts',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../components/hq/TeamWorkspace.tsx',import.meta.url),'utf8');
const pending=readFileSync(new URL('../components/hq/PendingInvitations.tsx',import.meta.url),'utf8');
const lifecycleMigration=readFileSync(new URL('../supabase/migrations/036_reliable_staff_invitations.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/037_secure_staff_invitation_operations.sql',import.meta.url),'utf8');
const onboardingMigration=readFileSync(new URL('../supabase/migrations/047_hq_employee_onboarding.sql',import.meta.url),'utf8');
const recoveryMigration=readFileSync(new URL('../supabase/migrations/052_staff_row_invitation_recovery.sql',import.meta.url),'utf8');
const onboardingPage=readFileSync(new URL('../app/hq/onboarding/page.tsx',import.meta.url),'utf8');
const onboardingForm=readFileSync(new URL('../components/hq/HQOnboardingForm.tsx',import.meta.url),'utf8');
const onboardingRoute=readFileSync(new URL('../app/api/hq/staff/onboarding/route.ts',import.meta.url),'utf8');
const callback=readFileSync(new URL('../app/auth/callback/route.ts',import.meta.url),'utf8');
const forgotPassword=readFileSync(new URL('../app/forgot-password/page.tsx',import.meta.url),'utf8');
const resetPassword=readFileSync(new URL('../app/reset-password/page.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/trade-police.css',import.meta.url),'utf8');

test('successful invitation persists every layer and returns honest delivery metadata',()=>{
 assert.match(route,/create_staff_invitation_v1/);
 assert.match(migration,/insert into public\.staff_roles[\s\S]+insert into public\.organization_members[\s\S]+insert into public\.staff_invitations/);
 assert.match(route,/status:201/);assert.match(route,/accepted:true,confirmed:false/);
 assert.doesNotMatch(route,/Invitation sent to/);
});
test('staff invitations always use the canonical HQ onboarding callback',()=>{
 assert.match(route,/getCanonicalAppUrls\(\)\.hq/);
 assert.match(route,/\/auth\/callback\?next=\/hq\/onboarding/);
 assert.doesNotMatch(route,/new URL\(request\.url\)\.origin.*auth\/callback/);
});
test('canonical URL helper keeps production auth on the canonical hosts while Preview stays on the active deployment origin',()=>{
 assert.deepEqual(getCanonicalAppUrls({NEXT_PUBLIC_SITE_URL:'https://site.example',NEXT_PUBLIC_APP_URL:'https://portal.example',NEXT_PUBLIC_HQ_URL:'https://hq.example'}),{site:'https://site.example',portal:'https://portal.example',hq:'https://hq.example'});
 assert.deepEqual(getCanonicalAppUrls({VERCEL_ENV:'preview',NEXT_PUBLIC_VERCEL_URL:'trade-police-preview-123.vercel.app',NEXT_PUBLIC_SITE_URL:'https://portal.example',NEXT_PUBLIC_APP_URL:'https://portal.tradepolice.app',NEXT_PUBLIC_HQ_URL:'https://hq.tradepolice.app'}),{site:'https://trade-police-preview-123.vercel.app',portal:'https://trade-police-preview-123.vercel.app',hq:'https://trade-police-preview-123.vercel.app'});
 assert.equal(getHostnameRoutingDecision('trade-police-preview-123.vercel.app','/client/login').redirectTarget, undefined);
 assert.equal(getHostnameRoutingDecision('portal.tradepolice.app','/client/login').redirectTarget, undefined);
 assert.equal(getHostnameRoutingDecision('tradepolice.app','/client/login').redirectTarget, 'portal');
 assert.match(callback,/next\.startsWith\('\/hq'\) \? urls\.hq : urls\.portal/);
});
test('password recovery preserves HQ and client destinations',()=>{
 assert.match(forgotPassword,/portal.*=== 'hq'/);
 assert.match(forgotPassword,/reset-password\?portal=\$\{portal\}/);
 assert.match(resetPassword,/\/hq\/login\?password=updated/);
 assert.match(resetPassword,/\/client\/login\?password=updated/);
});
test('pending staff must set a password before atomic acceptance',()=>{
 assert.match(onboardingPage,/current_staff_invitation_onboarding_v1/);
 assert.match(onboardingForm,/auth\.updateUser\(\{password\}\)/);
 assert.match(onboardingForm,/\/api\/hq\/staff\/onboarding/);
 assert.match(onboardingRoute,/accept_staff_invitation_v1/);
 assert.match(onboardingMigration,/status='ACCEPTED'/);
 assert.match(onboardingMigration,/organization_members set status='ACTIVE'/);
 assert.match(onboardingMigration,/ACCEPT_STAFF_INVITATION/);
});
test('invitation acceptance is idempotent and pending staff have no HQ permissions',()=>{
 assert.match(onboardingMigration,/if invitation\.status='ACCEPTED'/);
 assert.match(onboardingMigration,/not exists\(select 1 from public\.staff_invitations si where si\.user_id=sr\.user_id and si\.status<>'ACCEPTED'\)/);
 assert.match(onboardingMigration,/email_confirmed_at is not null or u\.last_sign_in_at is not null/);
});
test('submit button has a loading state and is always restored',()=>{
 assert.match(workspace,/Sending invitation…/);assert.match(workspace,/disabled=\{busy\}/);assert.match(workspace,/finally\{[^}]+setBusy\(false\)/);
});
test('success and exact API errors remain visible above the open drawer',()=>{
 assert.match(workspace,/setNotice\(result\.message/);assert.match(workspace,/throw new Error\(result\.error/);
 assert.match(css,/\.team-workspace>\.warning\{position:fixed;z-index:220/);
});
test('duplicate employee and duplicate pending invitation are rejected',()=>{
 assert.match(route,/This email already belongs to an employee/);assert.match(route,/DUPLICATE_EMPLOYEE/);
 assert.match(route,/This email already has a pending invitation/);assert.match(route,/DUPLICATE_PENDING_INVITATION/);
});
test('duplicate lookup is scoped, authorized, and returns minimum fields',()=>{
 assert.match(migration,/check_staff_invitation_duplicate_v1\(p_email text\)/);
 assert.match(migration,/returns table\(id uuid,status text,expires_at timestamptz\)/);
 assert.match(migration,/si\.organization_id=caller_org/);
 assert.match(migration,/auth\.uid\(\) is null/);assert.match(migration,/has_staff_permission\('staff\.manage'\)/);
 assert.match(migration,/lower\(trim\(coalesce\(p_email,''\)\)\)/);assert.match(migration,/limit 1/);
});
test('invitation persistence validates every organizational dependency',()=>{
 for(const text of ['department_row.active','position_row.active',"profile_row.role_key='OWNER'",'position_row.department_id<>department_row.id','manager.organization_id=caller_org','manager.is_active'])assert.match(migration,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.match(migration,/This email already belongs to an employee/);assert.match(migration,/This email already has a pending invitation/);
});
test('missing profile and invalid organization choices return actionable errors',()=>{
 assert.match(route,/Permission profile is required\./);assert.match(migration,/selected position does not belong to this department/);
 assert.match(migration,/selected manager is inactive or ineligible/);
});
test('staff-management permission authorizes invitation actions server-side',()=>{
 assert.match(route,/has_staff_permission/);assert.doesNotMatch(route,/\['OWNER','SECURITY_ADMIN'\]/);
 assert.match(route,/You are not authorized to invite employees/);
});
test('Auth failure and rate limits become visible delivery failures',()=>{
 assert.match(route,/Supabase could not create the invitation/);assert.match(route,/Email rate limit exceeded/);
 assert.match(migration,/'DELIVERY_FAILED'/);assert.match(route,/auth_invitation_failed/);
});
test('database persistence failure compensates the Auth invitation',()=>{
 assert.match(route,/persistenceError/);assert.match(route,/admin\.auth\.admin\.deleteUser\(invitedUser\.id\)/);
 assert.match(route,/Auth invitation was cleaned up/);assert.match(route,/p_auth_cleanup_succeeded/);
 assert.match(route,/mark_staff_invitation_delivery_failed_v1/);
});
test('resend and revoke use scoped RPCs with eligibility and audit logging',()=>{
 assert.match(route,/resend_staff_invitation_prepare_v1/);assert.match(route,/mark_staff_invitation_resent_v1/);assert.match(route,/mark_staff_invitation_resend_failed_v1/);assert.match(route,/revoke_staff_invitation_v1/);
 assert.match(migration,/Invitation is not eligible for resend/);assert.match(migration,/Accepted invitations cannot be revoked/);
 assert.match(migration,/RESEND_STAFF_INVITATION/);assert.match(migration,/REVOKE_STAFF_INVITATION/);
});
test('resend replaces only an unconfirmed pending Auth invitation without duplicating staff',()=>{
 assert.doesNotMatch(route,/auth\.resend\(\{type:'signup'/);
 assert.match(route,/getUserById\(invitation\.userId\)/);
 assert.match(route,/deleteUser\(invitation\.userId\)/);
 assert.match(route,/inviteUserByEmail\(invitation\.email/);
 assert.match(route,/create_staff_invitation_v1/);
 assert.match(onboardingMigration,/email_confirmed_at is not null or auth_user\.last_sign_in_at is not null/);
});
test('provisioning states and service role access remain explicit and least privilege',()=>{
 for(const status of ['PENDING','ACCEPTED','DELIVERY_FAILED','PERSISTENCE_FAILED','REVOKED'])assert.match(onboardingMigration,new RegExp(status));
 assert.match(onboardingMigration,/grant select on table public\.staff_invitations to service_role/);
 assert.doesNotMatch(onboardingMigration,/grant .*staff_invitations.* to (?:anon|authenticated)/);
 assert.match(pending,/Copy status\/details/);assert.match(pending,/Resend invitation/);
});
test('route performs no direct queries against protected organizational tables',()=>{
 assert.doesNotMatch(route,/\.from\(['"](?:staff_invitations|staff_roles|org_departments|org_positions|permission_profiles|organization_members|admin_access_logs)['"]\)/);
 assert.match(route,/admin\.auth\.admin\.inviteUserByEmail/);assert.match(route,/admin\.auth\.admin\.deleteUser/);
});
test('definer functions are hardened and authenticated-only',()=>{
 const functions=['check_staff_invitation_duplicate_v1','prepare_staff_invitation_v1','create_staff_invitation_v1','mark_staff_invitation_delivery_failed_v1','resend_staff_invitation_prepare_v1','mark_staff_invitation_resent_v1','mark_staff_invitation_resend_failed_v1','revoke_staff_invitation_v1'];
 for(const fn of functions){assert.match(migration,new RegExp(`create or replace function public\\.${fn}`));assert.match(migration,new RegExp(`revoke all on function public\\.${fn}`));}
 assert.ok((migration.match(/security definer set search_path=public/g)??[]).length>=functions.length);
 assert.match(migration,/to authenticated/);assert.doesNotMatch(migration,/grant .* to service_role/);
});
test('pending invitations refresh and expose complete lifecycle actions',()=>{
 assert.match(workspace,/setInvitationRefresh/);assert.match(workspace,/PendingInvitations/);
 for(const field of ['Employee','Department','Position','Profile','Manager','Status','Created','Invited by','Resend','Revoke'])assert.match(pending,new RegExp(field));
 for(const status of ['PENDING','ACCEPTED','EXPIRED','DELIVERY_FAILED','REVOKED'])assert.match(lifecycleMigration,new RegExp(status));
});
test('team rows expose only safe invitation references and use the existing resend endpoint',()=>{
 assert.match(recoveryMigration,/case when can_manage then si\.id else null end invitation_id/);
 assert.match(recoveryMigration,/invitation_recovery_available/);
 assert.match(recoveryMigration,/has_staff_permission\('staff\.manage'\)/);
 assert.match(workspace,/invitation_id\?:string\|null/);
 assert.match(workspace,/Resend invitation/);
 assert.match(workspace,/action:'resend',invitationId:row\.invitation_id/);
 assert.match(workspace,/action:'resend',employeeId:row\.user_id/);
});
test('missing invitation recovery preserves the existing staff identity and organizational configuration',()=>{
 assert.match(recoveryMigration,/reconcile_staff_invitation_v1\(p_employee_id uuid,p_request_id uuid\)/);
 assert.match(recoveryMigration,/select \* into target from public\.staff_roles where user_id=p_employee_id and organization_id=caller_org for update/);
 assert.match(recoveryMigration,/select \* into target_user from auth\.users where id=target\.user_id/);
 assert.match(recoveryMigration,/insert into public\.staff_invitations/);
 assert.doesNotMatch(recoveryMigration,/insert into public\.staff_roles/);
 assert.doesNotMatch(recoveryMigration,/insert into public\.organization_members/);
 assert.match(recoveryMigration,/department_row\.id.*position_row\.id.*profile_row\.id/s);
 assert.match(recoveryMigration,/RECONCILE_STAFF_INVITATION/);
});
test('resend reconciles only when needed and preserves invitation lifecycle authority',()=>{
 assert.match(route,/reconcile_staff_invitation_v1/);
 assert.match(route,/if\(!invitationId\)/);
 assert.match(route,/resend_staff_invitation_prepare_v1/);
 assert.match(route,/inviteUserByEmail\(invitation\.email/);
 assert.match(route,/mark_staff_invitation_resent_v1/);
 assert.match(onboardingMigration,/status='ACCEPTED'/);
 assert.match(onboardingMigration,/last_sign_in_at/);
});
test('staff invitation recovery is authenticated-only and fails closed for unauthorized callers',()=>{
 assert.match(recoveryMigration,/auth\.uid\(\) is null then raise exception 'Authentication required'/);
 assert.match(recoveryMigration,/Staff management permission denied/);
 assert.match(recoveryMigration,/revoke all on function public\.reconcile_staff_invitation_v1\(uuid,uuid\) from public,anon/);
 assert.match(recoveryMigration,/grant execute on function public\.reconcile_staff_invitation_v1\(uuid,uuid\) to authenticated/);
});
test('non-JSON and network failures cannot fail silently',()=>{
 assert.match(workspace,/response\.text\(\)/);assert.match(workspace,/without a valid response/);assert.match(workspace,/catch\(error\)/);
 assert.match(route,/serverLog\('error','unexpected_failure'/);assert.match(route,/requestId/);
});
