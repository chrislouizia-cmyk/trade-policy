import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {memberAccessState} from '../lib/hq/member-access-state.ts';

const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');

test('employee operational access is derived from enablement and invitation/login evidence',()=>{
  assert.equal(memberAccessState({employeeEnabled:true,invitationStatus:'PENDING'}),'INVITED');
  assert.equal(memberAccessState({employeeEnabled:true,invitationStatus:'ACCEPTED'}),'PENDING');
  assert.equal(memberAccessState({employeeEnabled:true,invitationStatus:'ACCEPTED',lastActiveAt:'2026-08-18T10:00:00Z'}),'ACTIVE');
  assert.equal(memberAccessState({employeeEnabled:false,invitationStatus:'ACCEPTED',lastActiveAt:'2026-08-18T10:00:00Z'}),'REVOKED');
  assert.equal(memberAccessState({employeeEnabled:true,invitationStatus:'DELIVERY_FAILED'}),'FAILED');
});

test('HQ desktop navigation keeps primary operational workspaces out of More',()=>{
  const source=read('components/hq/HQNav.tsx');
  for(const label of ['Customers','Sales','System Operations','Compliance','Team','Support'])assert.match(source,new RegExp(`'${label}'`));
  assert.doesNotMatch(source,/desktopMore/);
});

test('system health uses independently inspectable provider cards',()=>{
  const source=read('components/hq/SystemHealth.tsx');
  assert.match(source,/hq-service-card-grid/);assert.match(source,/Latency/);assert.match(source,/Last check/);
  assert.doesNotMatch(source,/<div className="hq-system-strip">/);
});

test('strategy directory is browsable and paginated without a search query',()=>{
  const source=read('components/hq/StrategyCompatibilityInspector.tsx');
  assert.match(source,/pageSize','25/);assert.match(source,/Most used/);assert.match(source,/Recently active/);assert.match(source,/Page \{page\} of/);
  const route=read('app/api/admin/diagnostics/strategies/route.ts');
  assert.match(route,/all\.slice\(\(page-1\)\*pageSize,page\*pageSize\)/);
});

test('permission profile editor selects instead of toggling and remounts on profile identity',()=>{
  const source=read('components/hq/PermissionProfileManager.tsx');
  assert.match(source,/setEditing\(profile\)/);assert.match(source,/key=\{editing\?\.id\?\?'new'\}/);assert.match(source,/Close permission profile editor/);
  assert.doesNotMatch(source,/setEditing\(editing===profile/);
});
