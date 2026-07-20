import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration=readFileSync(new URL('../supabase/migrations/031_beta_intelligence_instrumentation.sql',import.meta.url),'utf8');
const route=readFileSync(new URL('../app/api/beta-intelligence/events/route.ts',import.meta.url),'utf8');
const client=readFileSync(new URL('../lib/beta-intelligence.ts',import.meta.url),'utf8');
const builder=readFileSync(new URL('../components/StrategyBuilder.tsx',import.meta.url),'utf8');
const validator=readFileSync(new URL('../components/TradeValidator.tsx',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../app/hq/system/beta-intelligence/page.tsx',import.meta.url),'utf8');
const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));

const events=['ONBOARDING_STARTED','ONBOARDING_COMPLETED','PLAYBOOK_CREATED','PLAYBOOK_UPDATED','PLAYBOOK_DUPLICATED','PLAYBOOK_ARCHIVED','PLAYBOOK_RESTORED','PLAYBOOK_DELETED','METHODOLOGY_CONFIRMED','METHODOLOGY_REJECTED','SIMULATION_APPROVED','SIMULATION_REJECTED','FIRST_ANALYSIS_STARTED','FIRST_ANALYSIS_COMPLETED','ANALYSIS_COMPLETED','ANALYSIS_ABANDONED'];

test('Beta Intelligence uses the complete allowlisted event contract',()=>{
  for(const event of events){assert.match(migration,new RegExp(event));assert.match(client,new RegExp(event));assert.match(route,new RegExp(event))}
  for(const field of ['user_id','occurred_at','playbook_id','event_type','app_version','platform','session_id'])assert.match(migration,new RegExp(field));
});

test('event API is narrow and derives identity timestamp and app version',()=>{
  assert.match(route,/\.strict\(\)/);
  assert.match(route,/getUser\(\)/);
  assert.equal(route.match(/1\.0\.0-beta\.21/)?.[0],packageJson.version);
  assert.doesNotMatch(route,/market|note|instrument|direction|entry|price/i);
  assert.match(migration,/occurred_at timestamptz not null default now\(\)/);
});

test('lifecycle methodology simulation and analysis transitions are instrumented',()=>{
  for(const event of events.filter(event=>!event.startsWith('FIRST_ANALYSIS')&&!['ANALYSIS_COMPLETED','ANALYSIS_ABANDONED'].includes(event)))assert.match(builder,new RegExp(event));
  for(const event of ['FIRST_ANALYSIS_STARTED','ANALYSIS_COMPLETED','ANALYSIS_ABANDONED'])assert.match(validator,new RegExp(event));
  assert.match(migration,/FIRST_ANALYSIS_COMPLETED/);
});

test('internal dashboard exposes only requested aggregate metrics',()=>{
  for(const label of ['Onboarding completion rate','Methodology rejection rate','Simulation acceptance rate','First analysis completion rate','Average onboarding duration'])assert.match(dashboard,new RegExp(label));
  assert.match(dashboard,/getHQContext\('system\.health'\)/);
  assert.match(dashboard,/No market data or personal notes are collected/);
});

test('logging stays low overhead and failure-isolated',()=>{
  assert.match(client,/keepalive:true/);
  assert.match(client,/\.catch\(\(\)=>undefined\)/);
  assert.match(client,/sessionStorage/);
});
