import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const route=readFileSync(new URL('../app/api/hq/staff/invite/route.ts',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../components/hq/TeamWorkspace.tsx',import.meta.url),'utf8');
const pending=readFileSync(new URL('../components/hq/PendingInvitations.tsx',import.meta.url),'utf8');
const lifecycleMigration=readFileSync(new URL('../supabase/migrations/036_reliable_staff_invitations.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/037_secure_staff_invitation_operations.sql',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/trade-police.css',import.meta.url),'utf8');

test('successful invitation persists every layer and returns honest delivery metadata',()=>{
 assert.match(route,/create_staff_invitation_v1/);
 assert.match(migration,/insert into public\.staff_roles[\s\S]+insert into public\.organization_members[\s\S]+insert into public\.staff_invitations/);
 assert.match(route,/status:201/);assert.match(route,/accepted:true,confirmed:false/);
 assert.doesNotMatch(route,/Invitation sent to/);
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
test('unauthorized callers are rejected server-side',()=>{
 assert.match(route,/has_staff_permission/);assert.match(route,/\['OWNER','SECURITY_ADMIN'\]/);
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
test('non-JSON and network failures cannot fail silently',()=>{
 assert.match(workspace,/response\.text\(\)/);assert.match(workspace,/without a valid response/);assert.match(workspace,/catch\(error\)/);
 assert.match(route,/serverLog\('error','unexpected_failure'/);assert.match(route,/requestId/);
});
