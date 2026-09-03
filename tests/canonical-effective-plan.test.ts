import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

const migrationPath = 'supabase/migrations/096_canonical_effective_plan_resolver.sql';

const migrationExists = fs.existsSync(migrationPath);

const migration = migrationExists ? read(migrationPath) : '';
const entitlements = read('lib/billing/entitlements.ts');
const state = read('lib/billing/state.ts');
const backtesting = read('lib/server/backtesting.ts');
const strategySave = read('app/api/strategies/save/route.ts');
const plans = read('lib/billing/plans.ts');

test('new canonical migration exists and defines the effective plan resolver contract', () => {
  assert.ok(migrationExists, 'Expected the canonical migration to exist.');
  assert.match(migration, /get_effective_plan_code_for_user/);
  assert.match(migration, /from public\.private_beta_applications a[\s\S]*v_ledger_status = 'APPROVED'/i);
  assert.match(migration, /internal_entitlement_overrides/i);
  assert.match(migration, /FOUNDER/i);
  assert.match(migration, /TEAM/i);
  assert.match(migration, /PRO/i);
  assert.match(migration, /ELITE/i);
  assert.match(migration, /PRIVATE_BETA/i);
  assert.match(migration, /FREE/i);
});

test('legacy backtest RPC delegates to the canonical resolver without removing compatibility', () => {
  assert.match(migration, /create or replace function public\.backtest_get_plan_code_for_user\(p_user_id uuid\)/i);
  assert.match(migration, /return public\.get_effective_plan_code_for_user\(p_user_id\)/i);
});

test('runtime billing uses canonical effective plan authority for entitlement decisions', () => {
  assert.match(entitlements, /get_effective_plan_code_for_user|effective.*plan/i);
  assert.match(state, /planFor\(|PlanCode/i);
  assert.match(backtesting, /backtest_get_plan_code_for_user/i);
  assert.match(strategySave, /getBillingState\(user\.id\)/i);
});

test('private beta cap rules and free cap rules are enforced in shared plan definitions', () => {
  assert.match(plans, /PRIVATE_BETA:\s*\{[\s\S]*maximumActiveStrategies:\s*5/);
  assert.match(plans, /FREE:\s*\{[\s\S]*maximumActiveStrategies:\s*1/);
  assert.match(plans, /FOUNDER:\s*\{[\s\S]*maximumActiveStrategies:\s*null/);
});

test('private beta strategy quota must resolve to 5 and backtest quota to 10', () => {
  assert.match(plans, /PRIVATE_BETA:\s*\{[\s\S]*maximumActiveStrategies:\s*5/);
  assert.match(backtesting, /PRIVATE_BETA:\s*10/);
  assert.match(migration, /return 'PRIVATE_BETA'/);
});

test('founder unlimited behavior is explicitly preserved', () => {
  assert.match(plans, /FOUNDER:\s*\{[\s\S]*maximumActiveStrategies:\s*null/);
  assert.match(migration, /return 'FOUNDER'/);
});
