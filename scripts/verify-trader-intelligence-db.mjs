import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// An isolated PostgreSQL fixture. Never connect this script to production.
const {PGlite}=await import(process.argv[2]?pathToFileURL(process.argv[2]).href:'@electric-sql/pglite');
const db=new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to anon,authenticated,service_role;
  grant execute on function auth.uid() to anon,authenticated,service_role;
  create table public.profiles(id uuid primary key references auth.users);
  create table public.trader_intelligence_profiles(user_id uuid primary key references auth.users,timezone text default 'UTC',last_intraday_refresh_at timestamptz);
  create table public.active_trades(id uuid primary key,user_id uuid references auth.users,status text);
  create table public.decision_reports(id uuid primary key,user_id uuid references auth.users);
  create table public.market_scans(id uuid primary key,user_id uuid references auth.users,server_created boolean);
  create table public.trader_memories(id uuid primary key,user_id uuid references auth.users);
  create table public.strategy_profiles(id uuid primary key,user_id uuid references auth.users);
  create table public.trader_intelligence_events(id uuid primary key,user_id uuid references auth.users,event_type text);
  create table public.trader_intelligence_interventions(id uuid primary key,user_id uuid references auth.users,response text);
  grant all on public.trader_intelligence_profiles to service_role;
  insert into auth.users values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
  insert into public.profiles select id from auth.users;
`);
const migration=fs.readFileSync(new URL('../supabase/migrations/20261008225747_trader_intelligence_integral.sql',import.meta.url),'utf8');
await db.exec(migration);
const first='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002';
await db.query('insert into trader_intelligence_settings(user_id) values($1),($2)',[first,second]);
await db.query("insert into trader_intelligence_experiments(user_id,hypothesis) values($1,'OVERRIDE'),($2,'OVERRIDE')",[first,second]);
async function asRole(role,user,sql,args=[]){
  await db.exec('begin');
  try{
    await db.exec(`set local role ${role}`);
    if(user)await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    return await db.query(sql,args);
  }finally{await db.exec('rollback');}
}
assert.equal((await asRole('authenticated',first,'select * from trader_intelligence_settings')).rows.length,1);
assert.equal((await asRole('authenticated',first,'select * from trader_intelligence_settings where user_id=$1',[second])).rows.length,0);
assert.equal((await asRole('authenticated',first,'select * from trader_intelligence_experiments')).rows.length,1);
assert.equal((await asRole('authenticated',first,'select * from trader_intelligence_experiments where user_id=$1',[second])).rows.length,0);
for(const role of ['anon','authenticated']){
  for(const sql of ['select * from trader_intelligence_jobs','insert into trader_intelligence_settings(user_id) values($1)','update trader_intelligence_settings set collective_opt_in=true where user_id=$1','delete from trader_intelligence_settings where user_id=$1', 'select * from claim_trader_intelligence_jobs(1,null)', "update trader_intelligence_experiments set status='EVALUATED' where user_id=$1", "select claim_trader_daily_brief($1,'2026-10-08')"]){
    await assert.rejects(()=>asRole(role,first,sql,sql.includes('$1')?[first]:[]),/permission denied/);
  }
}
await assert.rejects(()=>asRole('anon',null,'select * from trader_intelligence_settings'),/permission denied/);
const claim=await db.query('select * from claim_trader_intelligence_jobs(1,$1)',[first]);
assert.equal(claim.rows.length,1);
assert.equal((await db.query('select * from claim_trader_intelligence_jobs(1,$1)',[first])).rows.length,0);
const lease=claim.rows[0];
// A material change during the run must remain pending after completion.
await db.query('insert into trader_memories(id,user_id) values(gen_random_uuid(),$1)',[first]);
assert.equal((await db.query('select finish_trader_intelligence_job($1,$2,$3,true) as done',[first,lease.requested_version,lease.lease_id])).rows[0].done,true);
assert.equal((await db.query('select requested_version>completed_version as pending from trader_intelligence_jobs where user_id=$1',[first])).rows[0].pending,true);
assert.equal((await db.query('select finish_trader_intelligence_job($1,$2,$3,true) as done',[first,lease.requested_version,lease.lease_id])).rows[0].done,false);
const next=(await db.query('select * from claim_trader_intelligence_jobs(1,$1)',[first])).rows[0];
await db.query('select finish_trader_intelligence_job($1,$2,$3,false)',[first,next.requested_version,next.lease_id]);
assert.equal((await db.query('select * from claim_trader_intelligence_jobs(1,$1)',[first])).rows.length,0);
assert.equal((await db.query('select claim_trader_daily_brief($1,$2) as claimed',[first,'2026-10-08'])).rows[0].claimed,true);
assert.equal((await db.query('select claim_trader_daily_brief($1,$2) as claimed',[first,'2026-10-08'])).rows[0].claimed,false);
assert.equal((await db.query('select claim_trader_daily_brief($1,$2) as claimed',[first,'2026-10-09'])).rows[0].claimed,false);
await db.query("update trader_intelligence_profiles set daily_brief_claimed_at=now()-interval '25 hours' where user_id=$1",[first]);
assert.equal((await db.query('select claim_trader_daily_brief($1,$2) as claimed',[first,'2026-10-09'])).rows[0].claimed,true);
await db.close();
console.log('Isolated PostgreSQL checks passed: migration, grants, RLS, duplicate claims, retries, event races and daily generation limit.');
