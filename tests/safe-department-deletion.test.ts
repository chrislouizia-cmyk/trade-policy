import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {positionsForDepartment} from '../lib/organizational-structure.ts';

const migration=readFileSync(new URL('../supabase/migrations/035_safe_department_deletion.sql',import.meta.url),'utf8');
const component=readFileSync(new URL('../components/hq/DepartmentDeletionManager.tsx',import.meta.url),'utf8');
const invite=readFileSync(new URL('../app/api/hq/staff/invite/route.ts',import.meta.url),'utf8');

test('a completely unused active or archived department is eligible for permanent deletion',()=>{
 assert.match(migration,/employee_count=0 and x\.position_count=0 and not x\.has_head and x\.pending_invitation_count=0/);
 assert.doesNotMatch(migration,/and d\.active/);
 assert.match(component,/check\?\.eligible/);
});
test('assigned employees block deletion at the database and UI layers',()=>{
 assert.match(migration,/count\(\*\).*staff_roles.*department_id=d\.id/);
 assert.match(migration,/if employee_count>0 or position_count>0/);
 assert.match(component,/employeeCount/);
});
test('positions block deletion and never cascade',()=>{
 assert.match(migration,/count\(\*\).*org_positions.*department_id=d\.id/);
 assert.match(migration,/department_id uuid references public\.org_departments\(id\) on delete restrict/);
 assert.doesNotMatch(migration,/on delete cascade/);
});
test('a department head blocks deletion',()=>{
 assert.match(migration,/department_head_employee_id is not null has_head/);
 assert.match(migration,/head_id is not null/);
});
test('pending staff invitations use a normalized restrictive reference and block deletion',()=>{
 assert.match(migration,/staff_invitations[\s\S]+department_id uuid references public\.org_departments\(id\) on delete restrict/);
 assert.match(migration,/status in \('INVITED','PENDING'\).*expires_at>now\(\)/);
 assert.match(invite,/department_id:department\.id/);
});
test('only Owner or authorized Admin callers can delete',()=>{
 assert.match(migration,/has_staff_permission\('staff\.manage'\)/);
 assert.match(migration,/caller_role='OWNER'.*caller_role='SECURITY_ADMIN'.*caller_profile='Admin'/s);
 assert.match(migration,/Only the Owner or an authorized Admin/);
});
test('the audit event is written before the permanent delete with required evidence',()=>{
 const audit=migration.indexOf("'DELETE_DEPARTMENT_PERMANENTLY'"),remove=migration.indexOf('delete from public.org_departments');
 assert.ok(audit>0&&remove>audit);for(const field of ['department_id','department_name','actor','deleted_at','deletion_reason'])assert.match(migration,new RegExp(field));
});
test('exact department name is required by both modal and RPC',()=>{
 assert.match(component,/confirmation!==deleting\.name/);
 assert.match(migration,/p_confirmation_name is distinct from department_name/);
 assert.match(component,/Type <strong>\{deleting\.name\}<\/strong> to confirm/);
});
test('Customer Service is a department while Head of Customer Service is its position',()=>{
 const department={id:'customer-service',name:'Customer Service'};
 const positions=[{id:'head',title:'Head of Customer Service',departmentId:department.id,active:true}];
 assert.equal(department.name,'Customer Service');assert.equal(positionsForDepartment(positions,department.id)[0].title,'Head of Customer Service');
 assert.notEqual(department.name,positions[0].title);
});
