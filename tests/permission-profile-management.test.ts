import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const migration=readFileSync(new URL('../supabase/migrations/034_permission_profile_management.sql',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../components/hq/TeamWorkspace.tsx',import.meta.url),'utf8');
const manager=readFileSync(new URL('../components/hq/PermissionProfileManager.tsx',import.meta.url),'utf8');
const invite=readFileSync(new URL('../app/api/hq/staff/invite/route.ts',import.meta.url),'utf8');
const invitationMigration=readFileSync(new URL('../supabase/migrations/037_secure_staff_invitation_operations.sql',import.meta.url),'utf8');
const defaults=['Admin','Support Manager','Support Agent','Sales Manager','Sales Representative','Compliance Officer','Risk Analyst','Finance','Read Only'];

test('all default permission profiles are seeded for staff organizations',()=>{
 for(const name of defaults)assert.match(migration,new RegExp(`\\('${name.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}'`));
 assert.match(migration,/staff_organizations[\s\S]+cross join profile_seed/);
});
test('permission profiles own independent permission bundles',()=>{
 assert.match(migration,/create table if not exists public\.permission_profile_permissions/);
 assert.match(migration,/join public\.permission_profile_permissions ppp on ppp\.profile_id=pp\.id/);
 assert.doesNotMatch(migration,/has_staff_permission[\s\S]+join public\.role_permissions rp/);
});
test('management UI supports creating editing archiving and choosing permissions',()=>{
 assert.match(workspace,/PermissionProfileManager/);assert.match(manager,/New profile/);assert.match(manager,/Edit permission profile/);
 assert.match(manager,/permissionKeys/);assert.match(manager,/Active permission profile/);assert.match(manager,/manage_permission_profile_v1/);
});
test('permission profile editor has an isolated, dismissible lifecycle',()=>{
 assert.match(manager,/createPortal/);assert.match(manager,/permission-profile-editor-backdrop/);assert.match(manager,/permission-profile-editor/);
 assert.match(manager,/onMouseDown=\{event=>\{if\(event\.target===event\.currentTarget\)closeEditor\(\)\}\}/);
 assert.match(manager,/event\.key==='Escape'/);assert.match(manager,/document\.body\.style\.overflow='hidden'/);
 assert.match(manager,/aria-label="Close permission profile editor"/);assert.match(manager,/onClick=\{closeEditor\}/);
 assert.match(manager,/setEditing\(undefined\);setDraft\(emptyDraft\);setEditorError\(''\)/);
});
test('permission profile editor swaps profiles and only closes after successful persistence',()=>{
 assert.match(manager,/const openEditor=\(profile:ManagedProfile\|null\)=>\{setEditing\(profile\);setDraft\(draftFromProfile\(profile\)\)/);
 assert.match(manager,/if\(error\)\{setEditorError\(error\.message/);
 assert.match(manager,/setSaving\(false\);if\(error\)/);
 assert.match(manager,/setEditing\(undefined\);setDraft\(emptyDraft\);setEditorError\(''\);setNotice/);
 assert.match(manager,/disabled=\{saving\}/);assert.match(manager,/Saving changes…/);
});
test('permission profile editor groups permissions and explains routing without changing grants',()=>{
 assert.match(manager,/permissionArea/);assert.match(manager,/permission-profile-permissions-heading/);
 assert.match(manager,/Sensitive permissions are marked/);assert.match(manager,/Routing determines where staff land in HQ\. It does not grant permissions\./);
});
test('profile changes are authorized validated protected and audited',()=>{
 assert.match(migration,/has_staff_permission\('staff\.manage'\)/);assert.match(migration,/Unknown permission supplied/);
 assert.match(migration,/Owner permission profile is protected/);assert.match(migration,/Reassign employees before archiving/);assert.match(migration,/MANAGE_PERMISSION_PROFILE/);
});
test('employee invitation uses active database profiles and protects Owner assignment',()=>{
 assert.match(workspace,/permissionProfiles\.filter\(p=>p\.active\)/);assert.match(invitationMigration,/public\.permission_profiles/);
 assert.match(workspace,/permissionProfiles:[^\n]+filter\([^\n]+roleKey!=='OWNER'/);
 assert.match(invitationMigration,/Owner permission profile cannot be assigned by invitation/);
});
