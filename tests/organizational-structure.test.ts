import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {buildOrgForest,positionsForDepartment,prioritizeManagers,wouldCreateReportingCycle} from '../lib/organizational-structure.ts';

const migration=readFileSync(new URL('../supabase/migrations/033_organizational_structure_v1.sql',import.meta.url),'utf8');
const invite=readFileSync(new URL('../app/api/hq/staff/invite/route.ts',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../components/hq/TeamWorkspace.tsx',import.meta.url),'utf8');

test('employee manager assignment references active staff and records manager audit changes',()=>{
 assert.match(migration,/reports_to_employee_id uuid references auth\.users/);assert.match(migration,/Reports To must reference an active employee/);assert.match(migration,/CHANGE_EMPLOYEE_MANAGER/);
});
test('self reporting is prevented in both selector behavior and database enforcement',()=>{
 assert.equal(prioritizeManagers([{id:'self',name:'Self',position:null,department:null,departmentId:null,managementLevel:0,role:'SUPPORT',isDepartmentHead:false}],'d','self').length,0);assert.match(migration,/cannot report to themselves/);
});
test('direct reporting cycles are rejected',()=>{assert.equal(wouldCreateReportingCycle('a','b',{a:'b',b:'a'}),true);assert.match(migration,/Reporting relationship would create a cycle/)});
test('indirect reporting cycles are rejected',()=>{assert.equal(wouldCreateReportingCycle('a','b',{b:'c',c:'d',d:'a'}),true);assert.match(migration,/with recursive managers/)});
test('inactive employees cannot be selected as managers',()=>{assert.match(migration,/m\.is_active/);assert.match(invite,/eq\('is_active',true\)/)});
test('department heads reference active employees and appear first in manager priority',()=>{
 const managers=[{id:'owner',name:'Owner',position:'Owner',department:null,departmentId:null,managementLevel:20,role:'OWNER',isDepartmentHead:false},{id:'head',name:'Head',position:'Head',department:'Support',departmentId:'support',managementLevel:10,role:'SUPPORT',isDepartmentHead:true}];assert.equal(prioritizeManagers(managers,'support')[0].id,'head');assert.match(migration,/Department head must be an active employee/);
});
test('manager deactivation requires reassignment and subordinate reassignment is audited',()=>{assert.match(migration,/Reassign direct reports before deactivating this manager/);assert.match(migration,/REASSIGN_MANAGER_REPORTS/);assert.match(migration,/update public\.staff_roles set reports_to_employee_id=p_reassign_reports_to/)});
test('position choices are filtered by selected department',()=>{assert.deepEqual(positionsForDepartment([{id:'1',departmentId:'a',active:true},{id:'2',departmentId:'b',active:true},{id:'3',departmentId:'a',active:false}],'a').map(x=>x.id),['1']);assert.match(workspace,/positionsForDepartment/)});
test('permission profiles remain independent of department position and manager',()=>{assert.match(migration,/join public\.permission_profiles pp/);assert.match(migration,/join public\.role_permissions rp on rp\.role=pp\.role_key/);assert.doesNotMatch(migration,/join public\.org_departments[^;]+role_permissions/)});
test('organizational changes create audit-log evidence',()=>{for(const action of ['CHANGE_EMPLOYEE_MANAGER','MANAGE_DEPARTMENT','MANAGE_POSITION','SUSPEND_STAFF'])assert.match(migration,new RegExp(action))});
test('employee form contains normalized organization fields and human manager context',()=>{for(const field of ['departmentId','positionId','permissionProfileId','reportsToEmployeeId'])assert.match(invite,new RegExp(field));assert.match(workspace,/m\.name.*m\.position.*m\.department/)});
test('org chart creates a hierarchy without drag-and-drop controls',()=>{const roots=buildOrgForest([{id:'o',name:'Owner',position:'Owner',department:null,reportsTo:null,directReports:1},{id:'h',name:'Head',position:'Head of Support',department:'Support',reportsTo:'o',directReports:1},{id:'a',name:'Agent',position:'Support Agent',department:'Support',reportsTo:'h',directReports:0}]);assert.equal(roots[0].children[0].children[0].name,'Agent');assert.doesNotMatch(workspace,/draggable|onDragStart/)});
