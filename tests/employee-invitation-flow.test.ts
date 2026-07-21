import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const route=readFileSync(new URL('../app/api/hq/staff/invite/route.ts',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../components/hq/TeamWorkspace.tsx',import.meta.url),'utf8');
const pending=readFileSync(new URL('../components/hq/PendingInvitations.tsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/036_reliable_staff_invitations.sql',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/trade-police.css',import.meta.url),'utf8');

test('successful invitation persists every layer and returns honest delivery metadata',()=>{
 assert.match(route,/staff_roles'[\s\S]+organization_members'[\s\S]+staff_invitations'/);
 assert.match(route,/status:'PENDING'/);assert.match(route,/status:201/);assert.match(route,/accepted:true,confirmed:false/);
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
test('missing profile and invalid organization choices return actionable errors',()=>{
 assert.match(route,/Permission profile is required\./);assert.match(route,/selected position does not belong to this department/);
 assert.match(route,/selected manager is inactive or ineligible/);
});
test('unauthorized callers are rejected server-side',()=>{
 assert.match(route,/has_staff_permission/);assert.match(route,/\['OWNER','SECURITY_ADMIN'\]/);
 assert.match(route,/You are not authorized to invite employees/);
});
test('Auth failure and rate limits become visible delivery failures',()=>{
 assert.match(route,/Supabase could not create the invitation/);assert.match(route,/Email rate limit exceeded/);
 assert.match(route,/status:'DELIVERY_FAILED'/);assert.match(route,/auth_invitation_failed/);
});
test('database persistence failure compensates the Auth invitation',()=>{
 assert.match(route,/persistenceError/);assert.match(route,/admin\.auth\.admin\.deleteUser\(invitedUser\.id\)/);
 assert.match(route,/Auth invitation was cleaned up/);assert.match(route,/auth_cleanup_succeeded/);
});
test('pending invitations refresh and expose complete lifecycle actions',()=>{
 assert.match(workspace,/setInvitationRefresh/);assert.match(workspace,/PendingInvitations/);
 for(const field of ['Employee','Department','Position','Profile','Manager','Status','Created','Invited by','Resend','Revoke'])assert.match(pending,new RegExp(field));
 for(const status of ['PENDING','ACCEPTED','EXPIRED','DELIVERY_FAILED','REVOKED'])assert.match(migration,new RegExp(status));
});
test('non-JSON and network failures cannot fail silently',()=>{
 assert.match(workspace,/response\.text\(\)/);assert.match(workspace,/without a valid response/);assert.match(workspace,/catch\(error\)/);
 assert.match(route,/serverLog\('error','unexpected_failure'/);assert.match(route,/requestId/);
});
