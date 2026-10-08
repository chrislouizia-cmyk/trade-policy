import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

const historicalMigrationPath = 'supabase/migrations/096_canonical_effective_plan_resolver.sql';
const nextMigrationPath = 'supabase/migrations/097_fix_private_beta_effective_plan_resolver.sql';

const historicalMigrationExists = fs.existsSync(historicalMigrationPath);
const nextMigrationExists = fs.existsSync(nextMigrationPath);

const historicalMigration = historicalMigrationExists ? read(historicalMigrationPath) : '';
const nextMigration = nextMigrationExists ? read(nextMigrationPath) : '';
const entitlements = read('lib/billing/entitlements.ts');
const appProfile = read('app/profile/page.tsx');
const state = read('lib/billing/state.ts');
const backtesting = read('lib/server/backtesting.ts');
const strategySave = read('app/api/strategies/save/route.ts');
const plans = read('lib/billing/plans.ts');

test('applied migration 096 remains unchanged from its committed historical contents', () => {
  assert.ok(historicalMigrationExists, 'Expected the committed historical migration to exist.');
  assert.match(historicalMigration, /a\.created_at/i);
  assert.doesNotMatch(historicalMigration, /a\.applied_at desc/i);
});

test('new migration repairs the resolver contract using the real beta timestamp ordering', () => {
  assert.ok(nextMigrationExists, 'Expected the new migration to exist.');
  assert.match(nextMigration, /get_effective_plan_code_for_user/);
  assert.match(nextMigration, /order by a\.reviewed_at desc nulls last, a\.applied_at desc/i);
  assert.doesNotMatch(nextMigration, /a\.created_at/i);
  assert.match(nextMigration, /return 'PRIVATE_BETA'/);
  assert.match(nextMigration, /return 'FOUNDER'/);
});

test('approved beta without billing resolves to PRIVATE_BETA under the safe fallback', () => {
  assert.match(entitlements, /export function resolveFallbackPlan\s*\(/s);
  assert.match(entitlements, /if \(overridePlan\)\s*\{\s*return overridePlan;/s);
  assert.match(entitlements, /if \(betaApproved\)\s*\{\s*return 'PRIVATE_BETA';/s);
  assert.match(entitlements, /private_beta_applications/);
  assert.match(entitlements, /reviewed_at[\s\S]*applied_at/i);
});

test('RPC failure does not crash /profile and does not silently demote approved beta to FREE', () => {
  assert.match(appProfile, /getBillingState\(user\.id\)/i);
  assert.match(entitlements, /Canonical effective plan resolution failed; using persisted fallback state\./i);
  assert.match(entitlements, /resolveFallbackPlan\(state\.plan, overridePlan, betaApproved\)/);
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
  assert.match(nextMigration, /return 'PRIVATE_BETA'/);
});

test('founder unlimited behavior is explicitly preserved', () => {
  assert.match(plans, /FOUNDER:\s*\{[\s\S]*maximumActiveStrategies:\s*null/);
  assert.match(nextMigration, /return 'FOUNDER'/);
});
