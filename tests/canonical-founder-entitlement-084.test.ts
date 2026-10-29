import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('084 creates canonical server-only entitlement overrides', () => {
  const migration = read('supabase/migrations/084_canonical_internal_entitlements.sql');
  assert.match(migration, /internal_entitlement_overrides/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /revoke all on table public\.internal_entitlement_overrides from public, anon, authenticated/i);
  assert.match(migration, /grant all on table public\.internal_entitlement_overrides to service_role/i);
});

test('084 migrates all current founders into canonical storage', () => {
  const migration = read('supabase/migrations/084_canonical_internal_entitlements.sql');
  for (const id of [
    '65a21633-51ea-419b-bd0c-e43f81c63b4e',
    'cee066a8-a590-4c1a-9c56-5e1c3617ca26',
    '935d9d88-893b-4163-b276-50bdb63c55e0',
  ]) assert.match(migration, new RegExp(id));
});

test('SQL resolver prioritizes canonical override', () => {
  const migration = read('supabase/migrations/084_canonical_internal_entitlements.sql');
  const overrideAt = migration.indexOf('internal_entitlement_overrides e');
  const billingAt = migration.indexOf('billing_subscriptions bs');
  const betaAt = migration.indexOf('is_beta_tester');
  assert.ok(overrideAt >= 0 && billingAt > overrideAt && betaAt > billingAt);
  assert.match(migration, /return v_override/i);
});

test('084 preserves an active Stripe-backed FOUNDER entitlement', () => {
  const migration = read('supabase/migrations/084_canonical_internal_entitlements.sql');
  assert.match(
    migration,
    /upper\(coalesce\(v_plan,''\)\)='FOUNDER'[\s\S]*return 'FOUNDER';/i,
  );
});

test('runtime billing override is DB-backed with no founder UUID hardcoding', () => {
  const source = read('lib/billing/overrides.ts');
  assert.match(source, /internal_entitlement_overrides/);
  assert.doesNotMatch(source, /65a21633-51ea-419b-bd0c-e43f81c63b4e/);
});

test('backtester uses the authoritative SQL resolver only', () => {
  const source = read('lib/server/backtesting.ts');
  assert.match(source, /admin\.rpc\('backtest_get_plan_code_for_user'/);
  assert.doesNotMatch(source, /serverEntitlementOverride/);
});
