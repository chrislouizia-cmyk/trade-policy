import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path:string)=>fs.readFileSync(path,'utf8');
const migration=read('supabase/migrations/20260922051137_owner_executive_command_center.sql');

test('owner command center is server-authorized and not exposed publicly',()=>{
  assert.match(migration,/if auth\.uid\(\) is null then raise exception 'Authentication required'/);
  assert.match(migration,/not public\.is_owner\(\).*not public\.has_staff_permission\('hq\.view'\)/s);
  assert.match(migration,/security definer/);
  assert.match(migration,/revoke all on function public\.staff_owner_command_center\(\) from public,anon/);
  assert.match(migration,/grant execute on function public\.staff_owner_command_center\(\) to authenticated/);
});

test('executive metrics use canonical customer, strategy, trade, and workload sources',()=>{
  for(const source of ['public.profiles','public.usage_events','public.active_trades','public.strategy_profiles','public.support_tickets','public.beta_feedback','public.compliance_cases','public.system_incidents','public.sales_leads']){
    assert.match(migration,new RegExp(source.replaceAll('.','\\.')));
  }
  assert.match(migration,/upper\(t\.status\)='OPEN'/);
  assert.match(migration,/not coalesce\(s\.is_archived,false\)/);
  assert.match(migration,/not exists\(select 1 from public\.staff_roles/);
  assert.doesNotMatch(migration,/trade_records/);
});

test('cross-department attention is prioritized, bounded, and navigable',()=>{
  for(const kind of ["'INCIDENT'","'COMPLIANCE'","'SUPPORT'","'SALES'"])assert.match(migration,new RegExp(kind));
  assert.match(migration,/order by priority_rank,occurred_at desc limit 12/);
  assert.match(migration,/'href','\/hq\/system\/queue'/);
  assert.match(migration,/'href','\/hq\/compliance\/cases\/'\|\|c\.id::text/);
  assert.match(migration,/'href','\/hq\/support'/);
  assert.match(migration,/'href','\/hq\/sales'/);
});

test('company activity and dashboard failure states remain explicit',()=>{
  const page=read('app/hq/page.tsx');
  const dashboard=read('components/admin/AdminDashboard.tsx');
  assert.match(migration,/order by occurred_at desc limit 16/);
  assert.match(migration,/'CUSTOMER_ACTIVITY'/);
  assert.match(migration,/public\.admin_access_logs/);
  assert.match(page,/loadError=\{commandCenterError\?'Executive data could not be loaded/);
  assert.match(dashboard,/Command center unavailable/);
  assert.match(dashboard,/Data source unavailable/);
  assert.doesNotMatch(dashboard,/Not available yet/);
});
