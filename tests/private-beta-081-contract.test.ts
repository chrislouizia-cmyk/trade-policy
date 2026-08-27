import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/081_private_beta_program_and_free_lifetime_credit.sql', 'utf8');
const backtesting = fs.readFileSync('lib/server/backtesting.ts', 'utf8');
const backtestRoute = fs.readFileSync('app/api/backtests/route.ts', 'utf8');
const dashboard = fs.readFileSync('components/Dashboard.tsx', 'utf8');
const betaCard = fs.readFileSync('components/PrivateBetaCard.tsx', 'utf8');
const hqNav = fs.readFileSync('components/hq/HQNav.tsx', 'utf8');
const hqQueue = fs.readFileSync('components/hq/PrivateBetaQueue.tsx', 'utf8');

test('081 creates the capped private beta application contract', () => {
  assert.match(migration, /create table if not exists public\.private_beta_applications/i);
  assert.match(migration, /'PENDING','APPROVED','WAITLISTED','REJECTED'/);
  assert.match(migration, /v_approved >= 1000/);
  assert.match(migration, /'WAITLISTED'/);
  assert.match(migration, /'beta\.manage'/);
});

test('081 preserves existing beta testers as approved', () => {
  assert.match(migration, /where coalesce\(p\.is_beta_tester,false\)=true/i);
  assert.match(migration, /'APPROVED'/);
  assert.match(migration, /Existing beta tester preserved by migration 081/);
});

test('081 blocks self elevation and grants only safe profile writes', () => {
  assert.match(migration, /create or replace function public\.protect_profile_entitlements/);
  assert.match(migration, /new\.role is distinct from old\.role/);
  assert.match(migration, /new\.plan is distinct from old\.plan/);
  assert.match(migration, /new\.subscription_status is distinct from old\.subscription_status/);
  assert.match(migration, /new\.is_beta_tester is distinct from old\.is_beta_tester/);
  assert.match(migration, /new\.subscription_price_usd is distinct from old\.subscription_price_usd/);
  assert.match(migration, /new\.assigned_sales_user_id is distinct from old\.assigned_sales_user_id/);
  assert.match(migration, /current_user = 'authenticated'/);
  assert.match(migration, /revoke all on table public\.profiles from anon, authenticated/i);
  assert.match(migration, /grant select on table public\.profiles to authenticated/i);
  assert.match(migration, /grant update \([\s\S]*display_name[\s\S]*first_name[\s\S]*onboarding_version[\s\S]*updated_at[\s\S]*\) on table public\.profiles to authenticated/i);
});

test('081 resolves beta from server-managed profile state', () => {
  assert.match(migration, /select coalesce\(p\.is_beta_tester,false\)/);
  assert.match(migration, /return 'PRIVATE_BETA'/);
  assert.match(migration, /return 'FOUNDER'/);
  assert.match(migration, /return 'TEAM'/);
});

test('FREE has one lifetime backtest while beta has ten monthly', () => {
  assert.match(migration, /when v_plan_code='FREE' then 1/);
  assert.match(migration, /when v_plan_code='PRIVATE_BETA' then 10/);
  assert.match(migration, /:FREE:LIFETIME/);
  assert.match(migration, /r\.status='CONSUMED'/);
  assert.match(migration, /r\.status='RESERVED'/);
  assert.match(migration, /upper\(bu\.plan_code\)='FREE'/);
  assert.doesNotMatch(migration, /r\.status='RELEASED'\)::integer/);
});

test('atomic creation ignores caller plan claims', () => {
  assert.match(migration, /v_plan_code := public\.backtest_get_plan_code_for_user\(p_user_id\)/);
  assert.match(migration, /Ignore caller-supplied plan claims/);
});

test('server creation uses the atomic RPC and no direct run insert', () => {
  const createSection = backtesting.slice(
    backtesting.indexOf('export async function createBacktestRun'),
    backtesting.indexOf('export async function markBacktestRunning'),
  );
  assert.match(backtesting, /FREE: 1/);
  assert.match(createSection, /\.rpc\('backtest_create_run_atomic'/);
  assert.doesNotMatch(createSection, /\.from\('backtest_runs'\)\s*\.insert/);
  assert.match(createSection, /p_idempotency_key/);
});

test('backtest API accepts idempotency keys and has generic quota errors', () => {
  assert.match(backtestRoute, /idempotencyKey:/);
  assert.match(backtestRoute, /idempotencyKey: payload\.idempotencyKey/);
  assert.doesNotMatch(backtestRoute, /plan: 'PRO'/);
});

test('customer dashboard exposes private beta application status', () => {
  assert.match(dashboard, /PrivateBetaCard/);
  assert.match(betaCard, /Apply for Private Beta/);
  assert.match(betaCard, /one lifetime backtest/);
  assert.match(betaCard, /10 backtests per month/);
});

test('HQ has a dedicated beta management surface', () => {
  assert.match(hqNav, /\['Beta','\/hq\/private-beta','beta\.manage'\]/);
  assert.match(hqQueue, /APPROVE/);
  assert.match(hqQueue, /REJECT/);
});

test('081 seeds beta.manage into modern permission profiles', () => {
  assert.match(migration, /permission_profile_permissions\(profile_id, permission_key\)/);
  assert.match(migration, /select pp\.id, 'beta\.manage'/);
  assert.match(migration, /role_key in \('OWNER', 'HEAD_OF_SALES'\)/);
});
